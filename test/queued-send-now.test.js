import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { page } from './fixtures/dom.js';
import { el, html } from '../src/renderer/lib/dom.js';
import { selectQueued } from '../src/providers/queued-message.js';
import { Conversations } from '../src/main/conversations.js';
import { MemoryStore, MemoryHistory } from '../preview/memory-storage.js';
import { descriptor } from '../src/providers/claude/descriptor.js';

/** The tray over the message box, where what waits is shown (see queue-tray.js), and its entry for `text`. */
function trayOf() {
  const root = el(html`<section class="queue-tray" hidden></section>`);
  const said = el(html`<span role="status"></span>`);
  return {
    root,
    said,
    away() {},
    entries: () => root.querySelectorAll('.queue-tray-entry'),
    entry: (text) =>
      root.querySelectorAll('.queue-tray-entry').find((row) => row.querySelector('.queue-tray-text').title === text),
  };
}

test('queue selection retains exact objects and rejects stale or invalid selections without FIFO fallback', () => {
  const first = { id: 'first', text: 'same' };
  const second = { id: 'second', text: 'same', images: [{ data: 'AAAA' }], check: [{ name: 'review' }] };
  const third = { id: 'third', text: 'third' };
  const queue = [first, second, third];
  for (const id of ['removed', '', null]) {
    assert.equal(selectQueued(queue, id), false);
    assert.deepEqual(queue, [first, second, third]);
  }
  assert.equal(selectQueued(queue, second.id), true);
  assert.equal(queue[0], second);
  assert.deepEqual(queue, [second, first, third]);
  assert.equal(selectQueued(queue), true);
  assert.deepEqual(queue, [second, first, third]);
});

test('the second queued row sends its own id once while IPC is pending', async (t) => {
  page(t);
  const root = el(
    html`<div>
      <div class="msg me"><div class="text">same</div></div>
      <div class="msg me"><div class="text">same</div></div>
    </div>`
  );
  const tray = trayOf();
  const calls = [];
  let finish;
  const conversation = new Conversation(
    root,
    { participants: [] },
    {
      sendNow: (id) => {
        calls.push(id);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      tray,
    }
  );
  conversation.kept(root.children[0], { id: 'first', text: 'same' });
  conversation.kept(root.children[1], { id: 'second', text: 'same' });
  conversation.showWaiting(2);
  assert.equal(tray.root.hidden, false);
  assert.equal(tray.entries().length, 2);
  assert.ok(
    [...root.children].every((node) => node.classList.contains('waiting')),
    'both leave the lines for the tray'
  );
  const button = tray.entries()[1].querySelector('.queue-tray-now');
  button.click();
  button.click();
  assert.deepEqual(calls, ['second']);
  assert.equal(button.disabled, true);
  finish();
  await Promise.resolve();
  assert.equal(button.disabled, false);
});

test('a queued row cannot send until its history identity arrives', (t) => {
  page(t);
  const root = el(
    html`<div>
      <div class="msg me"><div class="text">waiting</div></div>
    </div>`
  );
  const tray = trayOf();
  const calls = [];
  const conversation = new Conversation(root, { participants: [] }, { sendNow: async (id) => calls.push(id), tray });
  conversation.showWaiting(1);
  assert.equal(tray.root.querySelector('.queue-tray-now').disabled, true);
  conversation.kept(root.children[0], { id: 'kept', text: 'waiting' });
  assert.equal(tray.root.querySelector('.queue-tray-now').disabled, false);
});

test('the sandboxed preload forwards the selected id as a separate IPC argument', async () => {
  const calls = [];
  let api;
  vm.runInNewContext(fs.readFileSync(new URL('../src/preload/index.cjs', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name, value) => {
          api = value;
        },
      },
      ipcRenderer: {
        invoke: (...args) => {
          calls.push(args);
          return Promise.resolve();
        },
        on() {},
      },
    }),
  });
  await api.chat.sendNow('contact', 'second');
  assert.deepEqual(calls, [['chat:send-now', 'contact', 'second']]);
});

test('a waiting manager notice offers Send now and Cancel by id, with escaped text', async (t) => {
  page(t);
  const previousCSS = globalThis.CSS;
  globalThis.CSS = { escape: (value) => value };
  t.after(() => {
    globalThis.CSS = previousCSS;
  });
  const root = el(html`<div></div>`);
  const tray = trayOf();
  const calls = [];
  const conversation = new Conversation(
    root,
    { participants: [] },
    {
      sendNow: async (id) => calls.push(['send', id]),
      cancel: async (sent) => calls.push(['cancel', sent.id, sent.managerNote]),
      edit: async (sent) => calls.push(['edit', sent.id]),
      tray,
    }
  );
  const text = 'Manager says: <img src=x onerror=bad()>';
  const note = conversation.addNotice(text, { id: 'note', managerNote: true });
  conversation.showWaitingNotes(['note']);
  assert.ok(note.classList.contains('waiting'));
  const entry = tray.entry(text);
  assert.equal(tray.root.querySelector('img'), null);
  assert.match(entry.textContent, /<img src=x onerror=bad\(\)>/);
  assert.equal(entry.querySelector('.queue-tray-edit'), null, 'a note with no words of its sender’s has no Edit');
  entry.querySelector('.queue-tray-now').click();
  await Promise.resolve();
  await Promise.resolve();
  entry.querySelector('.queue-tray-cancel').click();
  await Promise.resolve();
  assert.deepEqual(calls, [
    ['send', 'note'],
    ['cancel', 'note', true],
  ]);
  conversation.showWaiting(0);
  assert.equal(tray.entries().length, 1, 'user waiting updates leave manager notes alone');
  conversation.showWaitingNotes([]);
  assert.equal(tray.entries().length, 0);
  assert.equal(tray.root.hidden, true);
  assert.equal(note.classList.contains('waiting'), false);
  conversation.remove('note');
  assert.equal(root.children.length, 0);
});

test('a waiting manager message with its sender’s words offers Edit, which hands over the note', async (t) => {
  page(t);
  const previousCSS = globalThis.CSS;
  globalThis.CSS = { escape: (value) => value };
  t.after(() => {
    globalThis.CSS = previousCSS;
  });
  const tray = trayOf();
  const calls = [];
  const conversation = new Conversation(
    el(html`<div></div>`),
    { participants: [] },
    {
      sendNow: async () => {},
      cancel: async () => {},
      edit: async (sent) => calls.push(sent),
      tray,
    }
  );
  const text = 'shop manager says: Add a test for the empty cart';
  conversation.addNotice(text, { id: 'note', managerNote: true, words: true });
  conversation.showWaitingNotes(['note'], 'stopped');
  tray.entry(text).querySelector('.queue-tray-edit').click();
  await Promise.resolve();
  assert.deepEqual(calls, [{ id: 'note', text, managerNote: true, words: true }]);
});

test('a rejected Send now reports why and leaves the queued button ready for retry', async (t) => {
  page(t);
  const root = el(
    html`<div>
      <div class="msg me"><div class="text">waiting</div></div>
    </div>`
  );
  const tray = trayOf();
  let calls = 0;
  const errors = [];
  const conversation = new Conversation(
    root,
    { participants: [] },
    {
      sendNow: async () => {
        calls += 1;
        throw new Error('This message is still queued. Try Send now again.');
      },
      tray,
    }
  );
  conversation.addError = (message) => errors.push(message);
  conversation.kept(root.children[0], { id: 'queued', text: 'waiting' });
  conversation.showWaiting(1);
  const button = tray.root.querySelector('.queue-tray-now');
  button.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Send now');
  assert.match(errors[0], /still queued/);
  button.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
});

for (const fifo of [false, true]) {
  test(`mixed user and manager queues clear only the delivered bubble (${fifo ? 'FIFO' : 'selected'})`, async (t) => {
    page(t);
    const previousCSS = globalThis.CSS;
    globalThis.CSS = { escape: (value) => value };
    t.after(() => {
      globalThis.CSS = previousCSS;
    });
    const root = el(
      html`<div>
        <div class="msg me"><div class="text">User follow-up</div></div>
      </div>`
    );
    const user = root.children[0];
    const tray = trayOf();
    const store = new MemoryStore();
    const contact = store.contacts[0];
    const history = new MemoryHistory();
    const queue = [];
    const calls = [];
    const delivered = [];
    let active = false;
    let deliver = false;
    const session = {
      contact,
      waiting: 0,
      get queuedIds() {
        return queue.map((message) => message.id);
      },
      send(message) {
        if (!active) {
          active = true;
          this.emit({ type: 'state', state: 'working' });
          return;
        }
        queue.push(message);
        this.waiting = queue.length;
        this.emit({ type: 'waiting', count: this.waiting });
      },
      async sendNow(id, options) {
        calls.push({ id, bounded: Boolean(options?.signal) });
        if (!deliver) return;
        const at = queue.findIndex((message) => message.id === id);
        assert.notEqual(at, -1);
        delivered.push(queue.splice(at, 1)[0].id);
        this.waiting = queue.length;
        this.emit({ type: 'waiting', count: this.waiting });
      },
    };
    const conversation = new Conversation(
      root,
      { participants: [] },
      {
        sendNow: (id) => model.sendNow(contact.id, fifo && id === user.dataset.id ? undefined : id),
        cancel: () => {},
        tray,
      }
    );
    const errors = [];
    conversation.addError = (message) => errors.push(message);
    const model = new Conversations({
      store,
      history,
      providers: {
        descriptor: () => descriptor,
        upgradeHistory: (_provider, entries) => entries,
        createSession: (_contact, emit) => Object.assign(session, { emit }),
      },
      chats: {
        isFocused: () => true,
        send: (_id, event) => {
          if (event.type === 'waiting') conversation.showWaiting(event.count, event.inLine, event.moved, event.ids);
          if (event.type === 'waiting-notes') conversation.showWaitingNotes(event.ids);
          if (event.type === 'notice')
            conversation.addNotice(event.text, { id: event.entryId, managerNote: event.managerNote });
        },
      },
      notifier: { dismiss() {} },
      onContactsChanged() {},
    });
    model.send(contact.id, { text: 'Working' });
    model.pass(contact.id, {
      key: 'manager-note',
      from: 'manager',
      line: 'Manager correction',
      note: 'Manager correction',
    });
    const [noteId] = model.snapshot(contact.id).waitingNotes;
    await model.hurryNote(contact.id, 'manager-note');
    const kept = model.send(contact.id, { text: 'User follow-up' });
    conversation.kept(user, kept, true);
    assert.deepEqual(session.queuedIds, [noteId, kept.id]);
    assert.equal(model.snapshot(contact.id).waiting, 1);
    assert.equal(tray.entries().length, 2);
    deliver = true;
    tray.entry('User follow-up').querySelector('.queue-tray-now').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(errors, []);
    assert.deepEqual(delivered, [kept.id]);
    assert.equal(tray.entry('User follow-up'), undefined, 'no stale Queued entry for the delivered user message');
    assert.equal(user.classList.contains('waiting'), false, 'it is a line of the conversation again');
    assert.equal(tray.entry('Manager correction').querySelector('.queue-tray-now').disabled, false);
    assert.equal(model.snapshot(contact.id).waiting, 0);
    assert.deepEqual(model.snapshot(contact.id).waitingNotes, [noteId]);
    await model.sendNow(contact.id);
    assert.equal(calls.length, 2, 'a manager note alone does not start the user Send now path');
    tray.entry('Manager correction').querySelector('.queue-tray-now').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(delivered, [kept.id, noteId]);
    assert.equal(tray.entries().length, 0);
    assert.equal(tray.root.hidden, true);
    assert.deepEqual(calls, [
      { id: noteId, bounded: true },
      { id: kept.id, bounded: true },
      { id: noteId, bounded: true },
    ]);
    assert.deepEqual(errors, []);
  });
}

test('a manager’s note read as a turn ends, behind a message of yours in line, moves no earlier message of yours', () => {
  const store = new MemoryStore();
  const contact = store.contacts[0];
  const history = new MemoryHistory();
  const queue = [];
  // As Claude's session has it: what is sent during a turn waits in its own line, the next starting once the turn
  // is over. It says it is idle before it hands the next one over, so a note read then waits behind yours, unnamed.
  const session = {
    contact,
    waiting: 0,
    busy: false,
    get queuedIds() {
      return queue.map((message) => message.id);
    },
    send(message) {
      if (!this.busy) {
        this.busy = true;
        this.emit({ type: 'state', state: 'working' });
        return;
      }
      queue.push(message);
      this.waiting = queue.length;
      this.emit({ type: 'waiting', count: this.waiting });
    },
    finish() {
      this.emit({ type: 'state', state: 'idle' });
      const next = queue.shift();
      this.waiting = queue.length;
      this.emit({ type: 'waiting', count: this.waiting });
      this.busy = Boolean(next);
      if (next) this.emit({ type: 'state', state: 'working' });
    },
  };
  const told = [];
  const model = new Conversations({
    store,
    history,
    providers: {
      descriptor: () => descriptor,
      upgradeHistory: (_provider, entries) => entries,
      createSession: (_contact, emit) => Object.assign(session, { emit }),
    },
    chats: { isFocused: () => true, send: (_id, event) => told.push(event) },
    notifier: { dismiss() {} },
    onContactsChanged() {},
  });
  const first = model.send(contact.id, { text: 'Work on the coupon code' });
  const second = model.send(contact.id, { text: 'Add tests for the coupon code' });
  model.pass(contact.id, { key: 'docs', from: 'manager', line: 'Manager says: docs', note: 'Then the docs' });
  session.finish();
  assert.deepEqual(session.queuedIds, [undefined], 'the note waits behind yours, unnamed');
  const waiting = told.filter((event) => event.type === 'waiting');
  assert.ok(
    waiting.every((event) => event.count <= 1),
    `only yours is counted: ${JSON.stringify(waiting)}`
  );
  assert.deepEqual(
    waiting.flatMap((event) => event.moved ?? []),
    [second.id],
    'only the message that waited moves down'
  );
  assert.equal(history.read(contact.id)[0].id, first.id, 'the first message stays where it was said');
  assert.equal(model.snapshot(contact.id).waiting, 0);
  session.finish();
  assert.deepEqual(
    history
      .read(contact.id)
      .filter((entry) => entry.kind === 'user')
      .map((entry) => entry.id),
    [first.id, second.id]
  );
});

test('a message a Stop dropped says it was not sent: as the history kept it, and as the app says so', (t) => {
  const document = page(t);
  // What you wrote has no emoticons to find here.
  globalThis.NodeFilter ??= { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  document.createTreeWalker = () => ({ nextNode: () => false });
  // The window finds a message by its id (see Conversation.message): these ids need no escaping.
  const css = globalThis.CSS;
  globalThis.CSS = { escape: (id) => id };
  t.after(() => {
    globalThis.CSS = css;
  });
  const root = document.createElement('div');
  document.body.append(root);
  const conversation = new Conversation(
    root,
    { participants: [{ id: 'claude', name: 'Claude' }], profile: { name: 'Sam' }, myColor: '#000' },
    { sendNow: async () => {}, cancel: async () => {} }
  );
  conversation.addUser({ id: 'u1', text: 'fix the build' });
  conversation.addUser({ id: 'u2', text: 'and the docs', dropped: true });
  conversation.addUser({ id: 'u3', text: 'and the tests', editable: true });
  conversation.showWaiting(1, false, [], ['u3']);
  const message = (id) => root.querySelector(`.msg[data-id="${id}"]`);
  const note = (id) => message(id).querySelector('.dropped-note')?.textContent ?? null;
  assert.equal(note('u1'), null, 'one that was read was sent');
  assert.equal(note('u2'), 'Not sent: you stopped before it was read.');
  assert.ok(message('u2').classList.contains('dropped'));
  assert.equal(note('u3'), null, 'one that waits says so, and nothing more');

  // Stopped, by whoever: it waits no more, says once that it was never sent, and has nothing to go back to.
  conversation.showWaiting(0);
  conversation.dropped(['u3']);
  conversation.dropped(['u3', 'gone']);
  assert.equal(note('u3'), 'Not sent: you stopped before it was read.');
  assert.equal(message('u3').querySelectorAll('.dropped-note').length, 1);
  assert.deepEqual(
    ['waiting', 'editable'].map((name) => message('u3').classList.contains(name)),
    [false, false]
  );
  assert.equal(message('u3').querySelector('.waiting-note'), null);
});

test('what waits leaves the lines for the tray, says who it is for in a group, and is a line again once read', (t) => {
  const document = page(t);
  globalThis.NodeFilter ??= { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  document.createTreeWalker = () => ({ nextNode: () => false });
  const css = globalThis.CSS;
  globalThis.CSS = { escape: (id) => id };
  t.after(() => {
    globalThis.CSS = css;
  });
  const root = document.createElement('div');
  document.body.append(root);
  const tray = trayOf();
  const participants = [
    { id: 'planner', name: 'Planner' },
    { id: 'reviewer', name: 'Reviewer' },
  ];
  const conversation = new Conversation(
    root,
    { participants, profile: { name: 'Sam' }, myColor: '#000' },
    { sendNow: async () => {}, cancel: async () => {}, edit: async () => {}, tray }
  );
  // As the window opens, with what waited before: drawn from the history, no news.
  conversation.batch(() => {
    conversation.addUser({ id: 'u1', text: 'start' });
    conversation.addUser({ id: 'u2', text: 'split it in two' });
  });
  conversation.showWaiting(1, true, [], ['u2'], { u2: ['planner', 'reviewer'] });
  assert.deepEqual(
    conversation.queued().map((one) => one.text),
    ['split it in two']
  );
  assert.equal(tray.said.textContent, '');
  // One sent now.
  conversation.addUser({ id: 'u3', text: '@Reviewer check it', pictures: [] });
  conversation.showWaiting(2, true, [], ['u2', 'u3'], { u2: ['planner', 'reviewer'], u3: ['reviewer'] });
  assert.equal(tray.said.textContent, 'Message queued.');
  assert.deepEqual(
    tray.entries().map((row) => row.querySelector('.queue-tray-to').textContent.trim()),
    ['to everyone', 'to Reviewer']
  );
  assert.deepEqual(
    tray.entries().map((row) => [...row.querySelectorAll('button.link')].map((button) => button.textContent.trim())),
    [
      ['Send now', 'Edit', 'Cancel'],
      ['Send now', 'Edit', 'Cancel'],
    ],
    'in line for a turn, any of them can be taken back'
  );
  // The first is read: it goes down to where it was read, and is a line again.
  conversation.addNotice('Planner ran the tests.');
  conversation.showWaiting(1, true, ['u2', 'u3'], ['u3'], { u3: ['reviewer'] });
  const lines = [...root.children].map((node) => node.dataset.id);
  assert.deepEqual(lines.slice(-2), ['u2', 'u3']);
  assert.equal(root.querySelector('[data-id="u2"]').classList.contains('waiting'), false);
  assert.deepEqual(
    conversation.queued().map((one) => one.text),
    ['@Reviewer check it']
  );
  conversation.showWaiting(0);
  assert.equal(tray.root.hidden, true);
});
