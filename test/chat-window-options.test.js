import { test } from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';

// Only the options crossing into the native window layer are tested here. Actual maximize/Restore
// and screen placement need Electron; this stand-in does not pretend to implement a BrowserWindow.
const contactWindows = `data:text/javascript,${encodeURIComponent(`
  export class ContactWindows {
    windows = new Map();
    get(id) { return this.windows.get(id); }
    open(contact, params = {}, options = {}) {
      if (this.get(contact.id)) return this.get(contact.id);
      const win = { params, options, on() {} };
      this.windows.set(contact.id, win);
      return win;
    }
    move(win, contact) {
      this.windows.delete(this.contactOf(win));
      this.windows.set(contact.id, win);
    }
    contactOf(win) {
      for (const [id, own] of this.windows) if (own === win) return id;
      return null;
    }
  }
`)}`;

let ChatWindows;
if (module.registerHooks) {
  const hook = module.registerHooks({
    resolve(name, context, next) {
      return name === './contact-windows.js' && context.parentURL.endsWith('/windows/chat-windows.js')
        ? { url: contactWindows, shortCircuit: true }
        : next(name, context);
    },
  });
  try {
    ({ ChatWindows } = await import('../src/main/windows/chat-windows.js'));
  } finally {
    hook.deregister();
  }
}
const opts = { skip: !ChatWindows };

test('new conversations pass the maximize choice alongside their ordinary restore width', opts, () => {
  for (const openWindowsMaximized of [undefined, false, true]) {
    for (const shown of [false, true]) {
      const chats = new ChatWindows({
        names: () => ['Claude'],
        settings: () => ({ openWindowsMaximized, contactsPane: { shown, width: 200 } }),
      });
      const win = chats.open({ id: 'one', name: 'Claude' });
      const { keptAs: _keptAs, ...options } = win.options;
      assert.deepEqual(options, {
        width: shown ? 1128 : 920,
        maximized: openWindowsMaximized === true,
      });
    }
  }
});

test('changing the setting affects the next new window, leaving an existing window alone', opts, () => {
  let openWindowsMaximized = false;
  const chats = new ChatWindows({
    names: () => ['Claude'],
    settings: () => ({ openWindowsMaximized }),
  });
  const first = { id: 'one', name: 'Claude' };
  const existing = chats.open(first);
  openWindowsMaximized = true;
  assert.equal(chats.open(first), existing);
  assert.equal(existing.options.maximized, false);
  assert.equal(chats.open({ id: 'two', name: 'Claude' }).options.maximized, true);
  openWindowsMaximized = false;
  assert.equal(chats.open({ id: 'three', name: 'Claude' }).options.maximized, false);
});

test('a conversation window keeps its pin for the conversation it shows', opts, () => {
  const chats = new ChatWindows({ names: () => ['Claude'], settings: () => ({}) });
  const win = chats.open({ id: 'one', name: 'Claude' });
  assert.equal(win.options.keptAs(win), 'one');
  // While it is being made, before it is listed as that contact's.
  assert.equal(win.options.keptAs({}), 'one');
  // Gone on to another conversation, what it does from then on is that one's.
  chats.show(win, { id: 'two', name: 'Claude' });
  assert.equal(win.options.keptAs(win), 'two');
});
