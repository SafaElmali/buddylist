// A window grows to make room for what opens beside what it shows, and gives the room
// back when that closes: a conversation's side pane, on its right, and Settings in a
// window too narrow for it. Each has a room of its own, so one can close while the
// other stays. The list of your contacts, on a conversation's left, takes its room
// from the conversation instead: showing and hiding it leaves the window as it is.
import { PANE_MIN_WIDTH, widened } from '../../shared/side-pane.js';

/**
 * What a window did for one of them.
 * @typedef {Object} Room
 * @property {number} grown  how much wider the window became
 * @property {number} moved  how far left it went, to stay on the screen
 * @property {number} floor  how much less narrow it can be made meanwhile
 */

/** @type {WeakMap<object, Map<string, Room>>} every window's rooms, by what each is for */
const rooms = new WeakMap();

/** A window that fills the screen has all the room there is, and keeps its size. */
const fillsScreen = (win) => win.isMaximized() || win.isFullScreen();

/**
 * Gives a room back: the window is as wide as before, and can be made as narrow again.
 * @param {Electron.BrowserWindow} win
 * @param {string} [part]  whose room: the side pane's, unless it says otherwise
 */
export function giveBack(win, part = 'pane') {
  const room = rooms.get(win)?.get(part);
  if (!room) return;
  rooms.get(win).delete(part);
  const { bounds, narrowest } = without(win, room);
  win.setMinimumSize(narrowest, win.getMinimumSize()[1]);
  if (!fillsScreen(win)) win.setBounds(bounds);
}

/**
 * The window as it would be without a room: where, and how narrow it could be made.
 * @param {Electron.BrowserWindow} win
 * @param {Room | undefined} room
 */
function without(win, room) {
  const narrowest = win.getMinimumSize()[0] - (room?.floor ?? 0);
  const bounds = win.getBounds();
  if (!room || fillsScreen(win)) return { bounds, narrowest };
  return {
    bounds: { ...bounds, x: bounds.x + room.moved, width: Math.max(narrowest, bounds.width - room.grown) },
    narrowest,
  };
}

/** @param {Electron.BrowserWindow} win @param {string} part @param {Room} room */
function keep(win, part, room) {
  if (!rooms.has(win)) rooms.set(win, new Map());
  rooms.get(win).set(part, room);
}

/**
 * @param {Electron.BrowserWindow} win
 * @param {number} width  how much room is asked for, or 0 once what asked has closed
 * @param {{ x: number, width: number }} area  the part of the screen the window can use
 * @param {object} [opts]
 * @param {string} [opts.part]  what the room is for
 * @param {number} [opts.floor]  how much less narrow the window can be made while it has the room: as much
 *   as a pane gets, unless the room is less, as a collapsed pane's rail is. With a floor, a room of 0 is
 *   kept too: Settings in a window that is wide enough already keeps it from being made narrower
 */
export function makeRoom(win, width, area, { part = 'pane', floor = Math.min(width, PANE_MIN_WIDTH) } = {}) {
  if (!(width > 0) && !(floor > 0)) return giveBack(win, part);
  // A window that has a room for this already goes from how it is straight to how it will be:
  // asked for the same room again, as the next contact's page in it does, it stays as it is.
  const had = rooms.get(win)?.get(part);
  rooms.get(win)?.delete(part);
  const { bounds: before, narrowest } = without(win, had);
  const minHeight = win.getMinimumSize()[1];
  win.setMinimumSize(narrowest, minHeight);
  const room = { grown: 0, moved: 0, floor };
  if (!fillsScreen(win)) {
    const after = widened(before, area, Math.round(width));
    win.setBounds(after);
    Object.assign(room, { grown: after.width - before.width, moved: before.x - after.x });
  }
  // Only now: a smallest width above the window's own would resize it first.
  win.setMinimumSize(narrowest + floor, minHeight);
  keep(win, part, room);
}
