import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { PinnedPaneTabs, pinnedTabsFrom, withPinnedTabs } from '../src/renderer/chat/pinned-pane-tabs.js';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else delete globalThis.localStorage;
});

function storage() {
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });
  return values;
}

const view = (tabs, more = {}) => ({ tabs, upper: null, lower: null, folded: false, full: false, ...more });

test('pin descriptors keep reopening information without retaining tab contents or executable callbacks', () => {
  const tab = {
    id: 'file:src/app.js',
    title: 'app.js',
    file: 'src/app.js',
    top: 240,
    plain: true,
    lower: false,
    body: { textContent: 'private file contents' },
    onSelect: () => {},
    icon: '<svg/>',
    pinned: false,
  };
  assert.deepEqual(pinnedTabsFrom([tab]), [
    { id: tab.id, title: 'app.js', file: 'src/app.js', top: 240, plain: true, lower: false, pinned: true },
  ]);
  assert.equal(tab.pinned, false, 'normalizing does not mutate the pane');
  assert.deepEqual(
    pinnedTabsFrom([
      { id: 'browser', url: 'http://localhost:3000/' },
      { id: 'plan', planFile: 'PLAN.md' },
    ]),
    [
      { id: 'browser', url: 'http://localhost:3000/', lower: false, pinned: true },
      { id: 'plan', planFile: 'PLAN.md', lower: false, pinned: true },
    ]
  );
});

test('invalid descriptors are ignored and duplicate ids retain the first position and descriptor', () => {
  for (const invalid of [undefined, null, false, 42, '', {}, { tabs: [] }]) {
    assert.deepEqual(pinnedTabsFrom(invalid), []);
  }
  assert.deepEqual(
    pinnedTabsFrom([
      null,
      false,
      'files',
      {},
      { id: 7 },
      { id: '' },
      { id: 'files', title: 'Files' },
      { id: 'shell', lower: true },
      { id: 'files', title: 'A later duplicate' },
    ]),
    [
      { id: 'files', title: 'Files', lower: false, pinned: true },
      { id: 'shell', lower: true, pinned: true },
    ]
  );
});

test('malformed optional reopening fields do not become instructions for a tab', () => {
  for (const top of [-1, Infinity, NaN, '120', null]) {
    assert.deepEqual(
      pinnedTabsFrom([{ id: 'file', lower: 'true', plain: 'true', top, title: {}, url: 2, file: [], planFile: false }]),
      [{ id: 'file', lower: false, pinned: true }]
    );
  }
  assert.equal(pinnedTabsFrom([{ id: 'file', top: 0 }])[0].top, 0);
});

test('only pinned tabs survive another instance, with each conversation retaining its own choices', () => {
  storage();
  const alice = new PinnedPaneTabs('alice');
  const bob = new PinnedPaneTabs('bob');
  assert.deepEqual(alice.read(), []);
  alice.keep(view([{ id: 'files', pinned: true }, { id: 'changes' }]));
  bob.keep(view([{ id: 'shell', title: 'Tests', lower: true, pinned: true }]));
  assert.deepEqual(new PinnedPaneTabs('alice').read(), [{ id: 'files', lower: false, pinned: true }]);
  assert.deepEqual(new PinnedPaneTabs('bob').read(), [{ id: 'shell', title: 'Tests', lower: true, pinned: true }]);
  assert.deepEqual(new PinnedPaneTabs('carol').read(), []);
});

test('unpinning or closing removes a saved pin without changing another conversation', () => {
  const values = storage();
  const alice = new PinnedPaneTabs('alice');
  const bob = new PinnedPaneTabs('bob');
  alice.keep(
    view([
      { id: 'files', pinned: true },
      { id: 'changes', pinned: true },
    ])
  );
  bob.keep(view([{ id: 'agents', pinned: true }]));
  alice.keep(
    view([
      { id: 'files', pinned: false },
      { id: 'changes', pinned: true },
    ])
  );
  assert.deepEqual(alice.read(), [{ id: 'changes', lower: false, pinned: true }]);
  alice.keep(view([]));
  assert.deepEqual(alice.read(), []);
  assert.deepEqual(bob.read(), [{ id: 'agents', lower: false, pinned: true }]);
  assert.equal(values.size, 1, 'no empty entry is kept for a contact with no pins');
});

test('saving again keeps the latest pin order and browser address', () => {
  storage();
  const pins = new PinnedPaneTabs('alice');
  pins.keep(
    view([
      { id: 'page', url: 'http://localhost:3000/', pinned: true },
      { id: 'files', pinned: true },
    ])
  );
  pins.keep(
    view([
      { id: 'files', pinned: true },
      { id: 'page', url: 'http://localhost:3000/settings', pinned: true },
    ])
  );
  assert.deepEqual(pins.read(), [
    { id: 'files', lower: false, pinned: true },
    { id: 'page', url: 'http://localhost:3000/settings', lower: false, pinned: true },
  ]);
});

test('a change of the pins is written to disk at once, and the same pins are not written again', () => {
  storage();
  let saved = 0;
  const pins = new PinnedPaneTabs('alice', { saved: () => (saved += 1) });
  pins.keep(view([{ id: 'files', pinned: true }]));
  assert.equal(saved, 1);
  // Selecting another tab, opening an unpinned one or folding the pane leaves the pins as they were.
  pins.keep(view([{ id: 'files', pinned: true }, { id: 'changes' }], { upper: 'changes', folded: true }));
  assert.equal(saved, 1);
  pins.keep(
    view([
      { id: 'files', pinned: true },
      { id: 'changes', pinned: true },
    ])
  );
  assert.equal(saved, 2);
  pins.keep(view([]));
  assert.equal(saved, 3);
  pins.keep(view([]));
  assert.equal(saved, 3);
  // A conversation that never had pins writes nothing either.
  new PinnedPaneTabs('bob', { saved: () => (saved += 1) }).keep(view([{ id: 'files' }]));
  assert.equal(saved, 3);
});

test('pins that could not be stored are not said to be written', () => {
  let saved = 0;
  const pins = new PinnedPaneTabs('alice', { saved: () => (saved += 1) });
  const denied = () => {
    throw new Error('Storage unavailable');
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: denied, removeItem: denied },
  });
  pins.keep(view([{ id: 'files', pinned: true }]));
  assert.equal(saved, 0);
});

test('corrupt stored data is recoverable by the next pin action', () => {
  const values = storage();
  const pins = new PinnedPaneTabs('alice');
  pins.keep(view([{ id: 'files', pinned: true }]));
  const key = [...values.keys()][0];
  for (const bad of ['{', 'null', 'false', '{"tabs":[]}', '[null,{},7]']) {
    values.set(key, bad);
    assert.deepEqual(pins.read(), [], bad);
  }
  pins.keep(view([{ id: 'changes', pinned: true }]));
  assert.deepEqual(pins.read(), [{ id: 'changes', lower: false, pinned: true }]);
});

test('denied storage access and quota failures do not prevent interacting with the pane', () => {
  const denied = () => {
    throw new Error('Storage unavailable');
  };
  const pins = new PinnedPaneTabs('alice');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: denied });
  assert.deepEqual(pins.read(), []);
  assert.doesNotThrow(() => pins.keep(view([{ id: 'files', pinned: true }])));
  assert.doesNotThrow(() => pins.keep(view([])));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: denied, removeItem: denied },
  });
  assert.deepEqual(pins.read(), []);
  assert.doesNotThrow(() => pins.keep(view([{ id: 'files', pinned: true }])));
  assert.doesNotThrow(() => pins.keep(view([])));
});

test('merging pins puts them first in saved order, with current content metadata, selection and pane layout', () => {
  const state = view(
    [
      { id: 'changes' },
      { id: 'page', url: 'http://localhost:3000/current', title: 'Current page' },
      { id: 'shell', lower: true },
    ],
    { upper: 'page', lower: 'shell', folded: true, full: true }
  );
  const pins = pinnedTabsFrom([
    { id: 'page', url: 'http://localhost:3000/old', title: 'Old page' },
    { id: 'files' },
    { id: 'plan', planFile: 'PLAN.md' },
  ]);
  const before = structuredClone({ state, pins });
  const merged = withPinnedTabs(state, pins);
  assert.deepEqual(
    merged.tabs.map((tab) => tab.id),
    ['page', 'files', 'plan', 'changes', 'shell']
  );
  assert.deepEqual(merged.tabs[0], {
    id: 'page',
    url: 'http://localhost:3000/current',
    title: 'Current page',
    lower: false,
    pinned: true,
  });
  assert.deepEqual({ ...merged, tabs: [] }, { ...state, tabs: [] });
  assert.deepEqual({ state, pins }, before, 'restoration leaves both input snapshots untouched');
});

test('durable pin choices override stale pin flags in a temporary pane view', () => {
  const state = view(
    [
      { id: 'files', pinned: true },
      { id: 'changes', pinned: false },
    ],
    { upper: 'files' }
  );
  const merged = withPinnedTabs(state, pinnedTabsFrom([{ id: 'changes' }]));
  assert.deepEqual(merged.tabs, [{ id: 'changes', lower: false, pinned: true }, { id: 'files' }]);
  assert.equal(merged.upper, 'files', 'unpinning does not change the active tab');
  assert.deepEqual(withPinnedTabs(state, []).tabs, [{ id: 'files' }, { id: 'changes' }]);
});

test('an empty pane regains unavailable or closed pins in saved order without choosing another active tab', () => {
  const state = view([], { folded: true });
  const pins = pinnedTabsFrom([
    { id: 'missing-file', file: 'removed.js' },
    { id: 'ended-shell', lower: true },
  ]);
  assert.deepEqual(withPinnedTabs(state, pins), { ...state, tabs: pins });
});

test('pins dragged into another order come back first, in that order, after an app restart', () => {
  storage();
  const pins = new PinnedPaneTabs('alice');
  pins.keep(view([{ id: 'checks', pinned: true }, { id: 'files', pinned: true }, { id: 'changes' }]));
  const defaults = view([{ id: 'files' }, { id: 'changes' }, { id: 'checks' }], { upper: 'files' });
  const restored = withPinnedTabs(defaults, new PinnedPaneTabs('alice').read());
  assert.deepEqual(
    restored.tabs.map((tab) => tab.id),
    ['checks', 'files', 'changes']
  );
  assert.deepEqual(
    restored.tabs.filter((tab) => tab.pinned).map((tab) => tab.id),
    ['checks', 'files']
  );
  assert.equal(restored.upper, 'files');
  assert.deepEqual(
    defaults.tabs.map((tab) => tab.id),
    ['files', 'changes', 'checks']
  );
});

test('pins are saved in the order they have at the front, and come back there in front of the default tabs', () => {
  storage();
  const pins = new PinnedPaneTabs('alice');
  pins.keep(
    view([
      { id: 'file:app.js', file: 'app.js', pinned: true },
      { id: 'page', url: 'http://localhost:3000/', pinned: true },
      { id: 'files' },
      { id: 'changes' },
      { id: 'checks' },
    ])
  );
  assert.deepEqual(
    pins.read().map((tab) => tab.id),
    ['file:app.js', 'page']
  );
  const restored = withPinnedTabs(view([{ id: 'files' }, { id: 'changes' }, { id: 'checks' }]), pins.read());
  assert.deepEqual(
    restored.tabs.map((tab) => tab.id),
    ['file:app.js', 'page', 'files', 'changes', 'checks']
  );
});

test('pins of both halves come back first, each tab retaining its half', () => {
  storage();
  const pins = new PinnedPaneTabs('alice');
  pins.keep(
    view([
      { id: 'terminal', lower: true, pinned: true },
      { id: 'setup', lower: true },
      { id: 'checks', pinned: true },
      { id: 'files' },
    ])
  );
  const restored = withPinnedTabs(view([{ id: 'setup', lower: true }, { id: 'files' }, { id: 'checks' }]), pins.read());
  assert.deepEqual(
    restored.tabs.filter((tab) => tab.lower).map((tab) => tab.id),
    ['terminal', 'setup']
  );
  assert.deepEqual(
    restored.tabs.filter((tab) => !tab.lower).map((tab) => tab.id),
    ['checks', 'files']
  );
});

test('pins saved with places among the other tabs by an earlier version all come back first, in saved order', () => {
  const values = storage();
  const pins = new PinnedPaneTabs('alice');
  values.set(
    pins.key,
    JSON.stringify([
      { id: 'file:app.js', file: 'app.js', lower: false, pinned: true, position: 1 },
      { id: 'terminal', lower: true, pinned: true, position: 3 },
      { id: 'page', url: 'http://localhost:3000/', lower: false, pinned: true, position: 4 },
      { id: 'first', position: 999 },
      { id: 'second', position: 0 },
      { id: 'third', position: -1 },
    ])
  );
  const read = pins.read();
  assert.deepEqual(
    read.map((tab) => tab.id),
    ['file:app.js', 'terminal', 'page', 'first', 'second', 'third']
  );
  assert.equal(
    read.some((tab) => Object.hasOwn(tab, 'position')),
    false,
    'a saved place is no longer kept'
  );
  const defaults = view([{ id: 'files' }, { id: 'changes' }, { id: 'script-setup', lower: true }]);
  const restored = withPinnedTabs(defaults, read);
  assert.deepEqual(
    restored.tabs.map((tab) => tab.id),
    ['file:app.js', 'terminal', 'page', 'first', 'second', 'third', 'files', 'changes', 'script-setup']
  );
  // Saved again, they keep that order, without places.
  pins.keep(restored);
  assert.deepEqual(JSON.parse(values.get(pins.key)), read);
});

test('an open pane view gets its pins in front, in the order they were pinned, keeping its selected tab', () => {
  const current = view([{ id: 'files' }, { id: 'changes' }, { id: 'checks' }], { upper: 'changes' });
  const pins = pinnedTabsFrom([{ id: 'checks' }, { id: 'files' }]);
  assert.deepEqual(
    withPinnedTabs(current, pins).tabs.map((tab) => tab.id),
    ['checks', 'files', 'changes']
  );
  assert.equal(withPinnedTabs(current, pins).upper, 'changes');
});
