import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { giveBack, makeRoom } from '../src/main/windows/side-pane.js';
import { draftsOf, planState } from '../src/renderer/chat/plans.js';
import {
  addMenu,
  besideFlex,
  draggedTo,
  heldPane,
  holdPane,
  keepCollapsed,
  keepPaneWidth,
  keptCollapsed,
  keptPaneWidth,
  landsAt,
  landsBefore,
  lowerShare,
  moved,
  neighbour,
  paneFlex,
  paneStateFrom,
  paneWanted,
  pinnedFirst,
  RAIL_WIDTH,
  roomWanted,
  tabMenu,
  withKept,
} from '../src/renderer/chat/side-pane.js';
import { PANE_MIN_WIDTH, widened } from '../src/shared/side-pane.js';

const SCREEN = { x: 0, y: 25, width: 1440, height: 875 };

test('a window grows to the right by what its pane asks for', () => {
  assert.deepEqual(widened({ x: 340, y: 70, width: 620, height: 580 }, SCREEN, 470), {
    x: 340,
    y: 70,
    width: 1090,
    height: 580,
  });
});

test('a window that would leave the screen moves left for the rest', () => {
  assert.deepEqual(widened({ x: 700, width: 620 }, SCREEN, 470), { x: 350, width: 1090 });
});

test('a window gets no wider than its screen', () => {
  assert.deepEqual(widened({ x: 200, width: 1100 }, SCREEN, 528), { x: 0, width: 1440 });
  // On a second screen, to the right of the first.
  assert.deepEqual(widened({ x: 1500, width: 1100 }, { x: 1440, width: 1280 }, 528), { x: 1440, width: 1280 });
});

test('a window that fills its screen, or more, stays as it is', () => {
  assert.deepEqual(widened({ x: 0, width: 1440 }, SCREEN, 400), { x: 0, width: 1440 });
  assert.deepEqual(widened({ x: -30, width: 1600 }, SCREEN, 400), { x: 0, width: 1600 });
  assert.deepEqual(widened({ x: 340, width: 620 }, SCREEN, 0), { x: 340, width: 620 });
  assert.deepEqual(widened({ x: 340, width: 620 }, SCREEN, -50), { x: 340, width: 620 });
});

/** A stand-in for a BrowserWindow: where it is, and how small it may get. */
function fakeWindow(bounds, { maximized = false } = {}) {
  const win = {
    bounds: { y: 70, height: 580, ...bounds },
    min: [470, 440],
    maximized,
    getBounds: () => ({ ...win.bounds }),
    setBounds: (next) => {
      win.bounds = { ...next };
    },
    getMinimumSize: () => [...win.min],
    setMinimumSize: (width, height) => {
      win.min = [width, height];
      // As Electron does: a window narrower than its smallest width is widened to it.
      win.bounds.width = Math.max(win.bounds.width, width);
    },
    isMaximized: () => win.maximized,
    isFullScreen: () => false,
  };
  return win;
}

test('a window makes room for its pane, and gives it back when the pane closes', () => {
  const win = fakeWindow({ x: 340, width: 620 });
  makeRoom(win, 473, SCREEN);
  assert.deepEqual(win.bounds, { x: 340, y: 70, width: 1093, height: 580 });
  assert.deepEqual(win.min, [470 + PANE_MIN_WIDTH, 440], 'with a pane in it, it can’t be made as narrow');

  makeRoom(win, 0, SCREEN);
  assert.deepEqual(win.bounds, { x: 340, y: 70, width: 620, height: 580 });
  assert.deepEqual(win.min, [470, 440]);
});

test('a window that moved left for its pane moves back', () => {
  const win = fakeWindow({ x: 700, width: 620 });
  makeRoom(win, 470, SCREEN);
  assert.deepEqual([win.bounds.x, win.bounds.width], [350, 1090]);
  makeRoom(win, 0, SCREEN);
  assert.deepEqual([win.bounds.x, win.bounds.width], [700, 620]);
});

test('a window resized while its pane was open only gives back what it took', () => {
  const win = fakeWindow({ x: 100, width: 620 });
  makeRoom(win, 400, SCREEN);
  win.bounds = { ...win.bounds, x: 60, width: 1300 };
  makeRoom(win, 0, SCREEN);
  assert.deepEqual([win.bounds.x, win.bounds.width], [60, 900]);

  // Made as narrow as it goes with a pane, it ends no narrower than it could be before.
  makeRoom(win, 400, SCREEN);
  win.bounds = { ...win.bounds, width: 470 + PANE_MIN_WIDTH };
  makeRoom(win, 0, SCREEN);
  assert.equal(win.bounds.width, 470);
});

test('a maximized window keeps its size, with or without a pane', () => {
  const win = fakeWindow({ x: 0, width: 1440 }, { maximized: true });
  makeRoom(win, 470, SCREEN);
  assert.equal(win.bounds.width, 1440);
  assert.deepEqual(win.min, [470 + PANE_MIN_WIDTH, 440]);
  // Restored while the pane is open, and closed after: it took no room, so it gives none back.
  win.maximized = false;
  win.bounds = { ...win.bounds, x: 340, width: 900 };
  makeRoom(win, 0, SCREEN);
  assert.deepEqual([win.bounds.x, win.bounds.width], [340, 900]);
  assert.deepEqual(win.min, [470, 440]);
});

test('closing a pane that was never opened changes nothing', () => {
  const win = fakeWindow({ x: 340, width: 620 });
  makeRoom(win, 0, SCREEN);
  assert.deepEqual(win.bounds, { x: 340, y: 70, width: 620, height: 580 });
  assert.deepEqual(win.min, [470, 440]);
});

test('a pane opened twice takes its room once', () => {
  const win = fakeWindow({ x: 100, width: 620 });
  makeRoom(win, 400, SCREEN);
  makeRoom(win, 300, SCREEN);
  assert.equal(win.bounds.width, 920);
  assert.deepEqual(win.min, [470 + PANE_MIN_WIDTH, 440]);
  makeRoom(win, 0, SCREEN);
  assert.equal(win.bounds.width, 620);
});

/** Every place and size the window is given, as it is given them. */
function followed(win) {
  const seen = [];
  for (const name of ['setBounds', 'setMinimumSize']) {
    const set = win[name];
    win[name] = (...args) => {
      set(...args);
      seen.push([win.bounds.x, win.bounds.width]);
    };
  }
  return seen;
}

test('a pane asked again for the room it has, as the next contact’s page asks, leaves the window as it is', () => {
  const win = fakeWindow({ x: 700, width: 620 });
  makeRoom(win, 470, SCREEN);
  const seen = followed(win);
  makeRoom(win, 470, SCREEN);
  assert.deepEqual([win.bounds.x, win.bounds.width], [350, 1090]);
  assert.ok(seen.length > 0);
  assert.ok(
    seen.every(([x, width]) => x === 350 && width === 1090),
    `not made narrower on the way: ${JSON.stringify(seen)}`
  );
  assert.deepEqual(win.min, [470 + PANE_MIN_WIDTH, 440]);
  makeRoom(win, 0, SCREEN);
  assert.deepEqual([win.bounds.x, win.bounds.width], [700, 620], 'and gives back what it took the first time');
});

test('a pane asked for more room, or less, goes straight to it', () => {
  const win = fakeWindow({ x: 100, width: 620 });
  makeRoom(win, 400, SCREEN);
  const seen = followed(win);
  makeRoom(win, 300, SCREEN);
  makeRoom(win, 500, SCREEN);
  assert.deepEqual(
    seen.map(([, width]) => width),
    [1020, 920, 920, 920, 1120, 1120],
    'no width but the old one and the new'
  );
});

test('a pane asked for the room it has in a window that fills its screen leaves it as it is', () => {
  const win = fakeWindow({ x: 0, width: 1440 }, { maximized: true });
  makeRoom(win, 470, SCREEN);
  makeRoom(win, 470, SCREEN);
  assert.equal(win.bounds.width, 1440);
  assert.deepEqual(win.min, [470 + PANE_MIN_WIDTH, 440], 'its floor is taken once');
});

test('a collapsed pane keeps the window no wider than its rail asks', () => {
  const win = fakeWindow({ x: 100, width: 620 });
  makeRoom(win, 473, SCREEN);
  assert.deepEqual(win.min, [470 + PANE_MIN_WIDTH, 440]);
  // Collapsed: the window gives back all but the rail, and can be made as narrow as that leaves it.
  makeRoom(win, RAIL_WIDTH + 8, SCREEN);
  assert.equal(win.bounds.width, 620 + RAIL_WIDTH + 8);
  assert.deepEqual(win.min, [470 + RAIL_WIDTH + 8, 440]);
  // Expanded again, a pane's floor is back.
  makeRoom(win, 473, SCREEN);
  assert.equal(win.bounds.width, 1093);
  assert.deepEqual(win.min, [470 + PANE_MIN_WIDTH, 440]);
  makeRoom(win, 0, SCREEN);
  assert.deepEqual([win.bounds.width, win.min[0]], [620, 470]);
});

// Settings in the contact list: as wide as Settings needs (660), and no narrower until Back.
const contactList = () => Object.assign(fakeWindow({ x: 40, width: 300 }), { min: [260, 420] });

test('a window too narrow for Settings grows to it while it is there, and gets its width back after', () => {
  const win = contactList();
  makeRoom(win, 360, SCREEN, { part: 'settings', floor: 400 });
  assert.deepEqual([win.bounds.x, win.bounds.width], [40, 660]);
  assert.deepEqual(win.min, [660, 420], 'it can’t be made narrower than Settings meanwhile');
  giveBack(win, 'settings');
  assert.deepEqual([win.bounds.x, win.bounds.width], [40, 300]);
  assert.deepEqual(win.min, [260, 420]);
});

test('a window wide enough for Settings stays as it is, and is kept from being made narrower than it meanwhile', () => {
  const win = Object.assign(contactList(), { bounds: { x: 40, y: 70, width: 720, height: 640 } });
  makeRoom(win, 0, SCREEN, { part: 'settings', floor: 400 });
  assert.deepEqual([win.bounds.width, win.min[0]], [720, 660]);
  giveBack(win, 'settings');
  assert.deepEqual([win.bounds.width, win.min[0]], [720, 260]);
});

test('without a floor, a room of nothing is still none', () => {
  const win = contactList();
  makeRoom(win, 0, SCREEN, { part: 'settings', floor: 0 });
  assert.deepEqual([win.bounds.width, win.min[0]], [300, 260]);
  giveBack(win, 'settings');
  assert.deepEqual([win.bounds.width, win.min[0]], [300, 260]);
});

test('closing the chosen tab goes to the next one, or else the one before', () => {
  assert.equal(neighbour(['a', 'b', 'c'], 'b'), 'c');
  assert.equal(neighbour(['a', 'b', 'c'], 'c'), 'b');
  assert.equal(neighbour(['a'], 'a'), null);
});

test('a pane is as wide as the widest its tabs ask for, and shares the window when none asks', () => {
  assert.equal(roomWanted([]), 0);
  assert.equal(roomWanted([{}, {}]), 0);
  assert.equal(roomWanted([{}, { room: 608 }]), 608);
  assert.equal(roomWanted([{ room: 608 }, { room: 420 }, {}]), 608);
  assert.equal(roomWanted([{ room: 0 }, { room: undefined }]), 0);
});

test('a collapsed pane wants only its rail, whatever its tabs or a drag asked', () => {
  const tabs = [{ room: 560 }, {}];
  assert.equal(paneWanted({ collapsed: true, chosen: 420, tabs }), RAIL_WIDTH);
  assert.equal(paneWanted({ collapsed: true, chosen: null, tabs: [] }), RAIL_WIDTH);
  assert.equal(paneWanted({ collapsed: false, chosen: 420, tabs }), 420, 'expanded, as wide as it was dragged');
  assert.equal(paneWanted({ collapsed: false, chosen: null, tabs }), 560, 'or as its tabs ask');
  assert.equal(paneWanted({ collapsed: false, chosen: null, tabs: [] }), 0, 'or it shares the window');
});

test('a pane keeps to the width it was asked for, and takes its share of more only for a tab that grows', () => {
  assert.equal(paneFlex(0, false), '', 'no width asked: the stylesheet has it share the window');
  assert.equal(paneFlex(0, true), '');
  assert.equal(paneFlex(608, false), '0 1 608px');
  assert.equal(paneFlex(640, true), '1 1 640px');
});

test('the conversation has what the pane leaves, or the other share beside a pane that grows', () => {
  assert.equal(besideFlex(0, false, 480), '');
  assert.equal(besideFlex(608, false, 480), '');
  assert.equal(besideFlex(0, true, 480), '', 'a pane without a width shares the window already');
  assert.equal(besideFlex(640, true, 480), '1 1 480px');
});

test('the bar dragged towards the conversation makes the pane wider, and narrower the other way', () => {
  const from = { pane: 640, conversation: 480, narrowest: 280 };
  assert.equal(draggedTo(from, 0), 640);
  assert.equal(draggedTo(from, 120), 760);
  assert.equal(draggedTo(from, -150.4), 490, 'a whole number of pixels');
});

test('a dragged pane takes no more than the conversation can give, and gets no narrower than a pane does', () => {
  const from = { pane: 640, conversation: 480, narrowest: 280 };
  assert.equal(draggedTo(from, 5000), 840, 'the conversation keeps its least width');
  assert.equal(draggedTo(from, -5000), PANE_MIN_WIDTH);
  assert.equal(draggedTo({ ...from, conversation: 280 }, 300), 640, 'nothing to give: the bar stays');
});

test('a pane a small screen left narrower than a pane gets is not made narrower still', () => {
  const from = { pane: 200, conversation: 280, narrowest: 280 };
  assert.equal(draggedTo(from, -80), 200);
  assert.equal(draggedTo({ ...from, conversation: 400 }, 60), 260, 'but wider, where there is room');
});

test('the bar between the halves dragged up makes the lower one taller, and shorter the other way', () => {
  const from = { upper: 360, lower: 240 };
  assert.equal(lowerShare(from, 0), 0.4);
  assert.equal(lowerShare(from, 120), 0.6);
  assert.equal(lowerShare(from, -60), 0.3);
});

test('neither half is dragged shorter than a half gets', () => {
  const from = { upper: 360, lower: 240 };
  assert.equal(lowerShare(from, 5000), 0.85, 'the upper half keeps its 90px');
  assert.equal(lowerShare(from, -5000), 0.15, 'and so does the lower one');
});

test('a half a short window left shorter than a half gets is not made shorter still', () => {
  assert.equal(lowerShare({ upper: 60, lower: 50 }, -30), 50 / 110);
  assert.equal(lowerShare({ upper: 60, lower: 50 }, 30), 50 / 110, 'nor the other half, by growing this one');
  assert.equal(lowerShare({ upper: 60, lower: 200 }, -150), 90 / 260, 'but the one with room still gives it');
});

/** What a window keeps while it is open, whatever contact it goes on to. */
function storage(saved = {}) {
  const kept = new Map(Object.entries(saved));
  globalThis.sessionStorage = {
    getItem: (key) => (kept.has(key) ? kept.get(key) : null),
    setItem: (key, value) => kept.set(key, String(value)),
    removeItem: (key) => kept.delete(key),
  };
  return kept;
}

afterEach(() => {
  delete globalThis.sessionStorage;
});

test('the width a pane was dragged to is there again once the window goes on to another contact', () => {
  storage();
  assert.equal(keptPaneWidth(), null, 'never dragged: as wide as its tabs ask');
  keepPaneWidth(420);
  assert.equal(keptPaneWidth(), 420);
  keepPaneWidth(380);
  assert.equal(keptPaneWidth(), 380, 'the last drag is the one kept');
});

test('a pane put back as its tabs ask, with a double-click, keeps no width', () => {
  const kept = storage();
  keepPaneWidth(420);
  keepPaneWidth(null);
  assert.equal(keptPaneWidth(), null);
  assert.equal(kept.size, 0);
});

test('a kept width that is no width at all is not one', () => {
  for (const saved of ['', '0', '-200', 'wide', '{}', 'null']) {
    storage({ sidePaneWidth: saved });
    assert.equal(keptPaneWidth(), null, saved);
  }
  storage({ sidePaneWidth: '420.6' });
  assert.equal(keptPaneWidth(), 421, 'a whole number of pixels');
});

test('a window that can keep nothing still has a pane, as wide as its tabs ask', () => {
  const denied = () => {
    throw new Error('denied');
  };
  globalThis.sessionStorage = { getItem: denied, setItem: denied, removeItem: denied };
  assert.equal(keptPaneWidth(), null);
  assert.doesNotThrow(() => keepPaneWidth(420));
  assert.doesNotThrow(() => keepPaneWidth(null));
});

test('a pane open as the page went has its place held on the next one, and a closed one has none', () => {
  storage();
  assert.equal(heldPane(), null, 'nothing held yet');
  holdPane({ wanted: 420, grows: false, conversation: 640 });
  assert.deepEqual(heldPane(), { wanted: 420, grows: false, conversation: 640 });
  holdPane({ wanted: 0, grows: true, conversation: 512 });
  assert.deepEqual(heldPane(), { wanted: 0, grows: true, conversation: 512 }, 'a pane that shares the window');
  holdPane(null);
  assert.equal(heldPane(), null);
});

test('a held place that is no place at all is not one', () => {
  for (const saved of [
    '',
    'null',
    '{}',
    'wide',
    '[]',
    '{"wanted":-1,"conversation":600}',
    '{"wanted":400,"conversation":0}',
  ]) {
    storage({ sidePaneHeld: saved });
    assert.equal(heldPane(), null, saved);
  }
  storage({ sidePaneHeld: '{"wanted":420.6,"grows":"yes","conversation":600.4}' });
  assert.deepEqual(
    heldPane(),
    { wanted: 421, grows: false, conversation: 600 },
    'whole pixels, and grows only if it said so'
  );
});

test('a window that can keep nothing holds no place for its pane', () => {
  const denied = () => {
    throw new Error('denied');
  };
  globalThis.sessionStorage = { getItem: denied, setItem: denied, removeItem: denied };
  assert.equal(heldPane(), null);
  assert.doesNotThrow(() => holdPane({ wanted: 420, grows: false, conversation: 640 }));
  assert.doesNotThrow(() => holdPane(null));
});

test('a pane collapsed in a window is collapsed for the next contact, until it is brought back out', () => {
  const kept = storage();
  assert.equal(keptCollapsed(), false, 'never collapsed: open');
  keepCollapsed(true);
  assert.equal(keptCollapsed(), true);
  keepCollapsed(false);
  assert.equal(keptCollapsed(), false);
  assert.equal(kept.size, 0, 'brought back out, it keeps nothing');
  for (const saved of ['', 'false', '1', 'yes', '{}']) {
    storage({ sidePaneCollapsed: saved });
    assert.equal(keptCollapsed(), false, saved);
  }
});

test('a window that can keep nothing has its pane open for every contact', () => {
  const denied = () => {
    throw new Error('denied');
  };
  globalThis.sessionStorage = { getItem: denied, setItem: denied, removeItem: denied };
  assert.equal(keptCollapsed(), false);
  assert.doesNotThrow(() => keepCollapsed(true));
  assert.doesNotThrow(() => keepCollapsed(false));
});

/** A pane with a web page and a file on top, on the file, and a terminal under them, folded away. */
const STATE = {
  tabs: [
    { id: 'page-1', url: 'http://localhost:3000/', lower: false },
    { id: 'file:src/app.js', file: 'src/app.js', lower: false },
    { id: 'changes', lower: false },
    { id: 'script-setup', lower: true },
    { id: 'shell-1', lower: true },
  ],
  upper: 'file:src/app.js',
  lower: 'shell-1',
  folded: true,
  full: false,
};

test('what a pane had open is there again when a window comes back to its contact', () => {
  assert.equal(paneStateFrom(null), null, 'never shown: nothing kept');
  assert.deepEqual(paneStateFrom(STATE), STATE);
  // What a tab said it takes to open it again comes back with it: how far a file was scrolled.
  const scrolled = { ...STATE, tabs: [{ id: 'file:a.md', file: 'a.md', top: 240, plain: true, lower: false }] };
  assert.deepEqual(paneStateFrom(scrolled).tabs, scrolled.tabs);
  const bob = { tabs: [], upper: null, lower: null, folded: false, full: false };
  assert.deepEqual(paneStateFrom(bob), bob, 'a pane that was closed is kept as one with nothing open');
});

test('a kept pane that is no pane at all is not one, and what is wrong in one is left out', () => {
  for (const kept of [undefined, null, '', 'wide', [], {}, { tabs: {} }, { tabs: 'changes' }]) {
    assert.equal(paneStateFrom(kept), null, JSON.stringify(kept));
  }
  assert.deepEqual(
    paneStateFrom({
      tabs: [null, 'changes', { id: 7 }, { id: 'files', lower: 'yes' }],
      upper: 3,
      folded: 'no',
      full: 1,
    }),
    { tabs: [{ id: 'files', lower: false }], upper: null, lower: null, folded: false, full: false }
  );
});

test('a dragged tab lands before the first tab whose middle is to its right, or after the last', () => {
  const tabs = [
    { id: 'a', left: 100, width: 80 },
    { id: 'b', left: 182, width: 100 },
    { id: 'c', left: 284, width: 60 },
  ];
  assert.equal(landsBefore(tabs, 0), 'a');
  assert.equal(landsBefore(tabs, 139), 'a');
  assert.equal(landsBefore(tabs, 140), 'b');
  assert.equal(landsBefore(tabs, 231), 'b');
  assert.equal(landsBefore(tabs, 232), 'c');
  assert.equal(landsBefore(tabs, 313), 'c');
  assert.equal(landsBefore(tabs, 314), null);
  assert.equal(landsBefore(tabs, 9999), null);
  assert.equal(landsBefore([], 50), null);
});

test('a tab moves to just before another, or to the end, and the rest keep their order', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moved(ids, 'd', 'a'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moved(ids, 'a', 'c'), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moved(ids, 'a', null), ['b', 'c', 'd', 'a']);
  assert.deepEqual(moved(ids, 'c', 'b'), ['a', 'c', 'b', 'd']);
  // Let go where it already is, nothing changes.
  assert.deepEqual(moved(ids, 'b', 'b'), ids);
  assert.deepEqual(moved(ids, 'b', 'c'), ids);
  assert.deepEqual(moved(ids, 'd', null), ids);
  // A tab that closed while it was dragged, or one to land before that did.
  assert.deepEqual(moved(ids, 'x', 'a'), ids);
  assert.deepEqual(moved(ids, 'a', 'x'), ['b', 'c', 'd', 'a']);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd'], 'the list it was given is left as it was');
});

// The lower half keeps the project's scripts: Setup and Run are there whenever it is.
const SETUP = { id: 'script-setup', lower: true };
const RUN = { id: 'script-run', lower: true };
const ids = (tabs) => tabs.map((tab) => tab.id);

test('a tab just pinned goes in front, after the tabs pinned before it, and the rest keep their order', () => {
  const tabs = [{ id: 'a', pinned: true }, { id: 'b' }, { id: 'c', pinned: true }, { id: 'd' }];
  const before = structuredClone(tabs);
  assert.deepEqual(ids(pinnedFirst(tabs, 'c')), ['a', 'c', 'b', 'd']);
  // The second pinned goes after the first, not before it.
  const second = [{ id: 'a', pinned: true }, { id: 'b' }, { id: 'c' }, { id: 'd', pinned: true }];
  assert.deepEqual(ids(pinnedFirst(second, 'd')), ['a', 'd', 'b', 'c']);
  // The first one pinned goes to the very front.
  assert.deepEqual(ids(pinnedFirst([{ id: 'a' }, { id: 'b' }, { id: 'c', pinned: true }], 'c')), ['c', 'a', 'b']);
  assert.deepEqual(tabs, before, 'the list it was given is left as it was');
});

test('a tab just unpinned goes first after the pinned ones', () => {
  const tabs = [{ id: 'a', pinned: true }, { id: 'c' }, { id: 'd', pinned: true }, { id: 'b' }];
  assert.deepEqual(ids(pinnedFirst(tabs, 'c')), ['a', 'd', 'c', 'b']);
  // With no pins left, it is the first tab.
  assert.deepEqual(ids(pinnedFirst([{ id: 'a' }, { id: 'b' }], 'a')), ['a', 'b']);
  assert.deepEqual(ids(pinnedFirst([{ id: 'b' }, { id: 'a' }], 'a')), ['a', 'b']);
});

test('tabs pinned among the others, as saved before pins came first, are put in front in their order', () => {
  const tabs = [{ id: 'files' }, { id: 'x', pinned: true }, { id: 'changes' }, { id: 'y', pinned: true }];
  assert.deepEqual(ids(pinnedFirst(tabs)), ['x', 'y', 'files', 'changes']);
  assert.deepEqual(ids(pinnedFirst(tabs, 'missing')), ['x', 'y', 'files', 'changes']);
  assert.deepEqual(pinnedFirst([]), []);
});

test('each half has its pins in front of its own tabs, and keeps its places among the other half’s', () => {
  const tabs = [
    { id: 'files' },
    SETUP,
    { id: 'changes', pinned: true },
    RUN,
    { id: 't1', lower: true, pinned: true },
    { id: 'checks' },
  ];
  // The upper half's slots are 0, 2 and 5; the lower half's 1, 3 and 4.
  assert.deepEqual(ids(pinnedFirst(tabs, 't1')), ['changes', 't1', 'files', 'script-setup', 'script-run', 'checks']);
  // A pinned terminal is in front of Setup and Run, which are not pinned.
  assert.deepEqual(ids(pinnedFirst(tabs).filter((tab) => tab.lower)), ['t1', 'script-setup', 'script-run']);
});

test('a tab dragged across the pinned ones lands at their edge: pinned tabs stay together in front', () => {
  const tabs = [{ id: 'p1', pinned: true }, { id: 'p2', pinned: true }, { id: 'u1' }, { id: 'u2' }];
  // An unpinned one let go among the pins lands first after them.
  assert.equal(landsAt(tabs, 'u2', 'p1'), 'u1');
  assert.equal(landsAt(tabs, 'u2', 'p2'), 'u1');
  assert.equal(landsAt(tabs, 'u1', 'p2'), 'u2', 'already first after the pins, it stays there');
  // A pinned one let go among the others lands last of the pins.
  assert.equal(landsAt(tabs, 'p1', null), 'u1');
  assert.equal(landsAt(tabs, 'p1', 'u2'), 'u1');
  // Within its own group it goes where it was let go.
  assert.equal(landsAt(tabs, 'p2', 'p1'), 'p1');
  assert.equal(landsAt(tabs, 'u2', 'u1'), 'u1');
  assert.equal(landsAt(tabs, 'u1', null), null);
  // Let go where it is, or with no tab of that id, nothing changes.
  assert.equal(landsAt(tabs, 'p1', 'p1'), 'p2');
  assert.equal(landsAt(tabs, 'gone', 'u1'), 'u1');
  // Landing where it says, the order keeps the pinned tabs in front.
  for (const id of ids(tabs))
    for (const at of [...ids(tabs), null]) {
      const landed = moved(ids(tabs), id, landsAt(tabs, id, at));
      const pinned = landed.map((tabId) => tabs.find((tab) => tab.id === tabId).pinned === true);
      assert.deepEqual(pinned, [true, true, false, false], `${id} let go before ${at}`);
    }
});

test('a terminal opened brings the scripts with it, in front of it, Setup first', () => {
  const files = { id: 'files' };
  const terminal = { id: 't1', lower: true };
  assert.deepEqual(ids(withKept([files, terminal], [SETUP, RUN])), ['files', 'script-setup', 'script-run', 't1']);
  // One of them opened by itself brings the other.
  assert.deepEqual(ids(withKept([RUN], [SETUP, RUN])), ['script-setup', 'script-run']);
  assert.deepEqual(ids(withKept([SETUP], [SETUP, RUN])), ['script-setup', 'script-run']);
});

test('a half with nothing in it gets none of the tabs it keeps, and the other half is left as it is', () => {
  const files = { id: 'files' };
  const changes = { id: 'changes' };
  assert.deepEqual(ids(withKept([files, changes], [SETUP, RUN])), ['files', 'changes']);
  assert.deepEqual(ids(withKept([], [SETUP, RUN])), []);
  const ended = { id: 'ended-shell', lower: true, unavailable: true };
  assert.deepEqual(ids(withKept([files, ended], [SETUP, RUN])), ['files', 'ended-shell']);
  assert.deepEqual(ids(withKept([files, ended, { id: 'live-shell', lower: true }], [SETUP, RUN])), [
    'files',
    'script-setup',
    'script-run',
    'ended-shell',
    'live-shell',
  ]);
});

test('tabs that are there already stay where they are, also where they were dragged to', () => {
  const [one, two] = [
    { id: 't1', lower: true },
    { id: 't2', lower: true },
  ];
  const dragged = [one, RUN, two, SETUP];
  assert.deepEqual(withKept(dragged, [SETUP, RUN]), dragged);
  // A third terminal goes after them all, as it always has.
  const three = { id: 't3', lower: true };
  assert.deepEqual(ids(withKept([...dragged, three], [SETUP, RUN])), ['t1', 'script-run', 't2', 'script-setup', 't3']);
});

test('a new plan takes the tabs of its agent’s drafts, and leaves the approved ones', () => {
  const plans = [
    { id: 'p1', speaker: 'claude', decision: 'approve-plan' },
    { id: 'p2', speaker: 'claude', decision: 'feedback' },
    { id: 'p3', speaker: 'claude', decision: 'cancelled' },
    { id: 'p4', speaker: 'opus', decision: 'feedback' },
    { id: 'p5', speaker: 'claude', decision: null },
  ];
  assert.deepEqual(draftsOf(plans, { speaker: 'claude' }), ['p2', 'p3']);
  assert.deepEqual(draftsOf(plans, { speaker: 'opus' }), ['p4']);
  assert.deepEqual(draftsOf(plans, { speaker: 'codex' }), []);
});

test('a list of plans says how each was answered', () => {
  assert.equal(planState(null), 'waiting for you');
  assert.equal(planState('approve-plan'), 'approved');
  assert.equal(planState('feedback'), 'sent back');
  assert.equal(planState('cancelled'), 'withdrawn');
  assert.equal(planState('deny'), 'answered');
});

// ---- the + after the last tab ---------------------------------------------------------------------

/** A kind of tab, which notes in `opened` that it was asked for. */
const kind = (label, opened, more = {}) => ({
  label,
  icon: `<svg data-for="${label}"/>`,
  open: () => opened.push(label),
  ...more,
});

test('the + lists exactly the kinds of tab there are, each with its shortcut', () => {
  const opened = [];
  const items = addMenu([kind('Changes', opened, { hint: '⇧⌘G' }), kind('Terminal', opened, { hint: '⌃`' })]);
  assert.deepEqual(
    items.map(({ label, hint, icon }) => [label, hint, icon]),
    [
      ['Changes', '⇧⌘G', '<svg data-for="Changes"/>'],
      ['Terminal', '⌃`', '<svg data-for="Terminal"/>'],
    ]
  );
  // Nothing greyed out for what isn't built: it is simply not there.
  assert.equal(
    items.some((item) => item.disabled || item.separator),
    false
  );
  assert.deepEqual(addMenu([]), []);
});

test('choosing a kind opens its tab', () => {
  const opened = [];
  const items = addMenu([kind('Changes', opened), kind('Terminal', opened)]);
  items[1].action();
  items[0].action();
  assert.deepEqual(opened, ['Terminal', 'Changes']);
});

test('in the browser preview, the kinds that need the desktop app are left out', () => {
  const opened = [];
  const kinds = [
    kind('Changes', opened),
    kind('Terminal', opened, { desktop: true }),
    kind('Browser', opened, { desktop: true }),
  ];
  assert.deepEqual(
    addMenu(kinds, { web: true }).map((item) => item.label),
    ['Changes']
  );
  assert.deepEqual(
    addMenu(kinds, { web: false }).map((item) => item.label),
    ['Changes', 'Terminal', 'Browser']
  );
  assert.deepEqual(
    addMenu(kinds).map((item) => item.label),
    ['Changes', 'Terminal', 'Browser']
  );
});

test('the conversation’s plans follow the kinds, under a line of their own', () => {
  const plans = [
    { label: 'Add a dark theme', hint: 'waiting for you' },
    { label: 'Tidy the tests', hint: 'approved' },
  ];
  const items = addMenu([kind('Changes', [])], { more: plans });
  assert.deepEqual(
    items.map((item) => (item.separator ? '---' : item.label)),
    ['Changes', '---', 'Add a dark theme', 'Tidy the tests']
  );
  assert.equal(items[2], plans[0], 'a plan is listed as File > View a plan lists it');
  // No line without something on both sides of it.
  assert.deepEqual(
    addMenu([kind('Changes', [])], { more: [] }).map((item) => item.label),
    ['Changes']
  );
  assert.deepEqual(addMenu([], { more: plans }), plans);
  assert.deepEqual(addMenu([kind('Terminal', [], { desktop: true })], { web: true, more: plans }), plans);
});

// ---- a room for each thing beside what a window shows ------------------------------------------------

test('the side pane and Settings each give back their own room, in any order', () => {
  const win = fakeWindow({ x: 340, width: 884 });
  const both = () => {
    // The pane's room is on the right, where the screen ends: the window moves left for the rest.
    makeRoom(win, 300, SCREEN);
    assert.deepEqual([win.bounds.x, win.bounds.width], [256, 1184]);
    makeRoom(win, 200, SCREEN, { part: 'settings', floor: 300 });
    assert.deepEqual([win.bounds.x, win.bounds.width], [56, 1384]);
    assert.deepEqual(win.min, [470 + PANE_MIN_WIDTH + 300, 440]);
  };

  both();
  giveBack(win);
  assert.deepEqual([win.bounds.x, win.bounds.width], [140, 1084]);
  assert.deepEqual(win.min, [470 + 300, 440], 'Settings still keeps the window from getting too narrow');
  giveBack(win, 'settings');
  assert.deepEqual([win.bounds.x, win.bounds.width], [340, 884]);
  assert.deepEqual(win.min, [470, 440]);

  // And the other way round: Settings goes back while the pane stays.
  both();
  giveBack(win, 'settings');
  assert.deepEqual([win.bounds.x, win.bounds.width], [256, 1184]);
  assert.deepEqual(win.min, [470 + PANE_MIN_WIDTH, 440]);
  giveBack(win);
  assert.deepEqual([win.bounds.x, win.bounds.width], [340, 884]);
  assert.deepEqual(win.min, [470, 440]);
});

test('a room that was never made is given back as nothing', () => {
  const win = fakeWindow({ x: 340, width: 884 });
  giveBack(win, 'settings');
  giveBack(win);
  assert.deepEqual([win.bounds.x, win.bounds.width, win.min[0]], [340, 884, 470]);
});

test('a maximized window keeps its bounds as its side pane and Settings open and close in either order', () => {
  for (const order of [
    ['pane', 'settings'],
    ['settings', 'pane'],
  ]) {
    const win = fakeWindow(SCREEN, { maximized: true });
    const bounds = win.getBounds();
    win.setBounds = () => assert.fail('a maximized window must not be repositioned or resized');
    makeRoom(win, 470, SCREEN);
    makeRoom(win, 0, SCREEN, { part: 'settings', floor: 190 });
    assert.deepEqual(win.getBounds(), bounds);
    for (const part of order) {
      giveBack(win, part);
      assert.deepEqual(win.getBounds(), bounds);
      assert.equal(win.isMaximized(), true);
    }
    assert.deepEqual(win.min, [470, 440]);
  }
});

test('a right-click on a tab offers what the tab has of its own first, such as adding a terminal to the message', () => {
  const done = [];
  const actions = { rename: () => done.push('rename'), close: () => done.push('close') };
  const labels = (items) => items.map((item) => (item.separator ? '—' : item.label));
  const terminal = {
    rename: () => 'dev',
    menu: () => [{ label: 'Add to message', action: () => done.push('mention') }],
  };
  const items = tabMenu(terminal, false, actions);
  assert.deepEqual(labels(items), ['Add to message', '—', 'Rename...', 'Close']);
  for (const item of items) item.action?.();
  assert.deepEqual(done, ['mention', 'rename', 'close']);
  // A script's tab is kept, and can't be renamed: what it has of its own is all, and with nothing, there is no menu.
  assert.deepEqual(labels(tabMenu({ menu: terminal.menu }, true, actions)), ['Add to message']);
  assert.deepEqual(tabMenu({ menu: () => [] }, true, actions), []);
  assert.deepEqual(labels(tabMenu({}, false, actions)), ['Close']);
});

test('a tab menu offers an accessible pin action even for tabs kept by their half', () => {
  let pins = 0;
  const actions = { pin: () => pins++, close: () => {}, rename: () => {} };
  const items = tabMenu({}, false, actions);
  assert.deepEqual(
    items.map(({ label }) => label),
    ['Pin tab', 'Close']
  );
  items[0].action();
  const kept = tabMenu({ pinned: true }, true, actions);
  assert.deepEqual(
    kept.map(({ label }) => label),
    ['Unpin tab']
  );
  kept[0].action();
  assert.equal(pins, 2);
});
