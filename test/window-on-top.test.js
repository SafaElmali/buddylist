import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/main/storage/store.js';
import { keepOnTop } from '../src/main/windows/on-top.js';
import { tempDir } from './fixtures/temp-dir.js';

const defaults = { defaultProvider: 'claude' };

/** A window as far as its pin goes: Electron says each change, as it does after setAlwaysOnTop. */
function fakeWindow() {
  const listeners = [];
  return {
    onTop: false,
    setAlwaysOnTop(on) {
      if (on === this.onTop) return;
      this.onTop = on;
      for (const listener of listeners) listener({}, on);
    },
    on(name, listener) {
      if (name === 'always-on-top-changed') listeners.push(listener);
    },
  };
}

test('a window opens on top of the others when it was left so, after a restart too', () => {
  const dir = tempDir('cm-on-top-');
  const store = new Store(dir, defaults);
  store.keepWindowState('contacts', { onTop: true });
  const restarted = new Store(dir, defaults);
  const list = fakeWindow();
  keepOnTop(list, () => 'contacts', restarted);
  assert.equal(list.onTop, true);
  // One that was never pinned opens as any window does.
  const chat = fakeWindow();
  keepOnTop(chat, () => 'a-contact', restarted);
  assert.equal(chat.onTop, false);
});

test('each change of a pin is kept, for whoever the window belongs to then', () => {
  const dir = tempDir('cm-on-top-');
  const store = new Store(dir, defaults);
  let shows = 'first';
  const win = fakeWindow();
  keepOnTop(win, () => shows, store);
  win.setAlwaysOnTop(true);
  assert.deepEqual(new Store(dir, defaults).windowState('first'), { onTop: true });
  // The window went on to another conversation: what it does from now on is that one's.
  shows = 'second';
  win.setAlwaysOnTop(false);
  assert.deepEqual(new Store(dir, defaults).windowState('second'), {});
  assert.deepEqual(new Store(dir, defaults).windowState('first'), { onTop: true });
  // A window that belongs to nobody any more keeps nothing.
  shows = null;
  win.setAlwaysOnTop(true);
  assert.deepEqual(new Store(dir, defaults).data.windows, { first: { onTop: true } });
});
