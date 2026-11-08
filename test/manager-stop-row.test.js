import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';

// Use the real painter and DOM element; the surrounding app isn't needed to check its accessible states.
test('the manager row exposes Stop only for its own live turn, with explicit pending and idle states', async (t) => {
  const document = page(t);
  globalThis.window = { messenger: {} };
  t.after(() => delete globalThis.window);
  const { paintManagerStop } = await import('../src/renderer/chat/chrome.js');
  const button = document.createElement('button');
  const manager = { id: 'manager', name: 'Content Page Manager V2', host: true, state: 'working' };
  const guest = { id: 'guest', name: 'Guest', state: 'working' };
  const ctx = { contact: { manages: 'project' }, participants: [manager] };
  const paint = (who = manager) => paintManagerStop(button, who, ctx);
  for (const state of ['working', 'waiting', 'connecting']) {
    manager.state = state;
    paint();
    assert.equal(button.hidden, false);
    assert.equal(button.textContent, 'Stop');
    assert.equal(button.getAttribute('aria-disabled'), 'false');
    assert.equal(button.getAttribute('aria-label'), "Stop Content Page Manager V2's current turn");
  }
  ctx.stopping = true;
  paint();
  assert.equal(button.textContent, 'Stopping…');
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  ctx.stopping = false;
  ctx.participants.push(guest);
  paint();
  assert.match(button.getAttribute('aria-label'), /including guests in this conversation/);
  for (const state of ['idle', 'offline']) {
    manager.state = state;
    paint();
    assert.equal(button.getAttribute('aria-disabled'), 'true', 'a busy guest does not make the manager busy');
    assert.match(button.getAttribute('aria-label'), /no current turn/);
  }
  paint(guest);
  assert.equal(button.hidden, true);
  ctx.contact.archived = true;
  paint();
  assert.equal(button.hidden, true);
  delete ctx.contact.archived;
  delete ctx.contact.manages;
  paint();
  assert.equal(button.hidden, true, 'ordinary contacts keep their existing actions');
});

test('a guest a manager invited says so beside its name, after what its role has it do', async (t) => {
  page(t);
  globalThis.window = { messenger: {} };
  t.after(() => delete globalThis.window);
  const { roleNote } = await import('../src/renderer/chat/chrome.js');
  assert.deepEqual(roleNote({ afterChanges: true, readOnly: true, invitedBy: 'shop manager' }), {
    text: 'after changes, read only, invited by shop manager',
    title:
      'It answers once the others are done, when they changed files. It doesn’t change files. ' +
      'shop manager invited it here, and hears what it says once each round is over.',
  });
  assert.deepEqual(roleNote({}), { text: '', title: '' });
});
