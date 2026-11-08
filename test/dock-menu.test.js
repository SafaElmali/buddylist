import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { dockMenu, listWindowsInDock } from '../src/main/dock-menu.js';

let nextId = 1;

/** A stand-in for a BrowserWindow, recording what is asked of it. */
class FakeWindow extends EventEmitter {
  calls = [];
  destroyed = false;
  minimized = false;

  constructor(title, { focusable = true } = {}) {
    super();
    this.id = nextId++;
    this.title = title;
    this.focusable = focusable;
  }
  getTitle() {
    return this.title;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isFocusable() {
    return this.focusable;
  }
  isMinimized() {
    return this.minimized;
  }
  restore() {
    this.minimized = false;
    this.calls.push('restore');
  }
  show() {
    this.calls.push('show');
  }
  focus() {
    this.calls.push('focus');
  }
}

const labels = (menu) => menu.map((item) => item.label);

// ---- the menu ----------------------------------------------------------------------------

test('the menu lists every window by its title, in the order they were opened', () => {
  const [contacts, website, api, settings] = [
    new FakeWindow('buddylist'),
    new FakeWindow('Claude (website) - Conversation'),
    new FakeWindow('Codex (api), Claude (api) - Conversation'),
    new FakeWindow('Settings'),
  ];
  // Electron hands them out in an order of its own.
  const windows = [website, settings, contacts, api];
  assert.deepEqual(labels(dockMenu(windows)), [
    'buddylist',
    'Claude (website) - Conversation',
    'Codex (api), Claude (api) - Conversation',
    'Settings',
  ]);
});

test('toasts and closed windows are left out', () => {
  const closed = new FakeWindow('Claude (api) - Conversation');
  closed.destroyed = true;
  const windows = [
    new FakeWindow('buddylist'),
    new FakeWindow('buddylist', { focusable: false }),
    closed,
    new FakeWindow('Claude (website) - Conversation'),
  ];
  assert.deepEqual(labels(dockMenu(windows)), ['buddylist', 'Claude (website) - Conversation']);
  assert.deepEqual(dockMenu([]), [], 'no window, no lines');
});

test('a line brings its window to the front, out of the Dock if it was minimized', () => {
  const open = new FakeWindow('Claude (website) - Conversation');
  const minimized = new FakeWindow('Claude (api) - Conversation');
  minimized.minimized = true;
  const [first, second] = dockMenu([open, minimized]);
  first.click();
  second.click();
  assert.deepEqual(open.calls, ['show', 'focus']);
  assert.deepEqual(minimized.calls, ['restore', 'show', 'focus']);
});

test('a window closed while the menu was open is left alone', () => {
  const win = new FakeWindow('Claude (website) - Conversation');
  const [line] = dockMenu([win]);
  win.destroyed = true;
  line.click();
  assert.deepEqual(win.calls, []);
});

// ---- keeping it up to date ---------------------------------------------------------------

/** The app with its windows, a Dock and a Menu that record what is set. */
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = new EventEmitter();
  let windows = [];
  const set = [];
  listWindowsInDock({
    app,
    dock: { setMenu: (menu) => set.push(menu) },
    Menu: { buildFromTemplate: (template) => template },
    windows: () => windows.filter((win) => !win.closedForGood),
  });
  const open = (title, options) => {
    const win = new FakeWindow(title, options);
    windows = [...windows, win];
    app.emit('browser-window-created', {}, win);
    return win;
  };
  const close = (win) => {
    win.destroyed = true;
    win.emit('closed');
    // Electron lets go of it after it told of it.
    win.closedForGood = true;
  };
  const retitle = (win, title) => {
    // Electron tells of the page's new title before it gives it to the window.
    win.emit('page-title-updated', {}, title);
    win.title = title;
  };
  return { open, close, retitle, set, menus: () => set.map(labels) };
}

test('a window that opens is in the menu, under the title its page gives it', (t) => {
  const { open, retitle, menus } = setup(t);
  const contacts = open('buddylist');
  assert.deepEqual(menus(), [], 'not before the change is made');
  t.mock.timers.tick(0);
  assert.deepEqual(menus(), [['buddylist']]);

  const chat = open('Claude (website) - Conversation');
  retitle(chat, 'Conversation');
  retitle(chat, 'Claude (website) - Conversation');
  t.mock.timers.tick(0);
  assert.deepEqual(menus().at(-1), ['buddylist', 'Claude (website) - Conversation']);
  assert.equal(menus().length, 2, 'changes in a row are one rebuild');

  retitle(chat, 'Claude (website), Codex (api) - Conversation');
  t.mock.timers.tick(0);
  assert.deepEqual(menus().at(-1), ['buddylist', 'Claude (website), Codex (api) - Conversation']);

  retitle(contacts, 'buddylist');
  t.mock.timers.tick(0);
  assert.equal(menus().length, 3, 'the same title again: nothing to rebuild');
});

test('a window that closes leaves the menu', (t) => {
  const { open, close, menus } = setup(t);
  open('buddylist');
  const chat = open('Claude (website) - Conversation');
  t.mock.timers.tick(0);
  close(chat);
  t.mock.timers.tick(0);
  assert.deepEqual(menus().at(-1), ['buddylist']);
});

test('another window under the same title gets a line of its own', (t) => {
  const { open, close, set } = setup(t);
  const before = open('Claude (website) - Conversation');
  t.mock.timers.tick(0);
  close(before);
  const after = open('Claude (website) - Conversation');
  t.mock.timers.tick(0);
  assert.equal(set.length, 2, 'the line must bring the new window to the front, not the closed one');
  set.at(-1)[0].click();
  assert.deepEqual(before.calls, []);
  assert.deepEqual(after.calls, ['show', 'focus']);
});

test('a toast that comes and goes changes nothing', (t) => {
  const { open, close, set } = setup(t);
  open('buddylist');
  t.mock.timers.tick(0);
  const toast = open('buddylist', { focusable: false });
  t.mock.timers.tick(0);
  close(toast);
  t.mock.timers.tick(0);
  assert.equal(set.length, 1);
});
