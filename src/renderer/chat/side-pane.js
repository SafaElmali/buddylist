// The pane beside the conversation, with a tab for everything open in it. It is
// there while it has a tab, or always in the app, and the window grows to make room
// for it: the conversation stays as wide as it was. The bar between the two drags the pane
// wider or narrower, and the pane can fill the window, over the conversation, or
// collapse to a rail at the window's side, its tabs kept out of sight.
// It has two halves, each with tabs of its own: what there is to look at on top
// (the folder's files and changes, a plan, a web page), and under it what runs
// there (the project's scripts, the terminals), which folds away, and whose top edge
// drags it taller or shorter. A half can keep
// tabs of its own, which are there whenever it is: the project's scripts are.
// What a tab holds is its own business: a plan (plans.js), the folder's changes
// (changes.js), a terminal (terminals.js), a web page (browser.js).
import { $, $$, el, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { openMenu } from '../lib/menu.js';
import { PANE_MIN_WIDTH } from '../../shared/side-pane.js';
import { widestFrom } from './sidebar.js';
import { tabArrows } from './tab-arrows.js';

/**
 * @typedef {Object} PaneTab
 * @property {string} id
 * @property {string} title
 * @property {string} icon        trusted SVG markup
 * @property {HTMLElement} body   what the pane shows while this tab is the chosen one
 * @property {boolean} [lower]    it goes in the pane's lower half, with what runs in the folder
 * @property {() => void} [onSelect]  called when it becomes the chosen one, to bring what it shows up to date
 * @property {() => void} [onClose]  the user closed this tab themselves, with its ✕ or the middle
 *   button. Not called when the whole pane is put away, or when the tab is closed for them
 * @property {number} [room]    how wide the pane has to be for this tab, in pixels: a terminal's 80 columns
 * @property {boolean} [grows]  better with more room than it asked for, as a web page is: the pane then
 *   takes its share of a window that is made wider
 * @property {(typed: string) => string} [rename]  the user typed another title for this tab; answers with the
 *   title it has from now on. A tab without this can't be renamed
 * @property {() => import('../lib/menu.js').MenuItem[]} [menu]  what a right-click on the tab offers before
 *   Rename and Close: a terminal's output, to add to the message
 * @property {() => Record<string, string>} [again]  what it takes to open this tab again, besides its id, when
 *   the window comes back to this contact: a web page's address, a file's path
 * @property {boolean} [pinned]  stays available when its content would otherwise put it away
 * @property {boolean} [unavailable]  its content is no longer available
 */

/**
 * What the pane had open as the window went on from a contact, to open again when it comes back.
 * @typedef {Object} PaneState
 * @property {({ id: string, lower?: boolean } & Record<string, unknown>)[]} tabs  in order, each with what its
 *   `again` said
 * @property {string | null} upper  the tab each half showed
 * @property {string | null} lower
 * @property {boolean} folded
 * @property {boolean} full
 */

/**
 * A kind of tab the pane's + can open.
 * @typedef {Object} PaneKind
 * @property {string} label
 * @property {string} icon        trusted SVG markup
 * @property {string} [hint]      its shortcut, as people write it
 * @property {boolean} [desktop]  needs the desktop app: a browser of its own, say. The browser preview has none
 * @property {() => void} open    opens its tab and goes to it
 */

/**
 * What a right-click on a tab offers: what the tab has of its own, such as a terminal's output to add to the
 * message, then Rename for one that can be, and Close for one its half does not keep.
 * @param {Pick<PaneTab, 'menu' | 'rename' | 'pinned'>} tab
 * @param {boolean} kept  its half keeps it: it has no ✕
 * @param {{ rename: () => void, close: () => void, pin?: () => void }} actions
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
export function tabMenu(tab, kept, { rename, close, pin }) {
  const own = tab.menu?.() ?? [];
  const general = [
    ...(pin ? [{ label: tab.pinned ? 'Unpin tab' : 'Pin tab', action: pin }] : []),
    ...(tab.rename ? [{ label: 'Rename...', action: rename }] : []),
    ...(kept ? [] : [{ label: 'Close', action: close }]),
  ];
  return own.length && general.length ? [...own, { separator: true }, ...general] : [...own, ...general];
}

/** Unless a tab says how much it needs, the pane asks the window for as much room as the conversation has, up to this. */
const MAX_ROOM = 520;

/** Collapsed, the pane is a rail this wide down the window's side, with the button that brings it back out. */
export const RAIL_WIDTH = 28;

/**
 * How wide the pane's tabs need it to be: the widest of what they asked for, or 0 when none did.
 * @param {Pick<PaneTab, 'room'>[]} tabs
 */
export const roomWanted = (tabs) => Math.max(0, ...tabs.map((tab) => tab.room || 0));

/**
 * How wide the pane wants to be: a collapsed one only as wide as its rail. Otherwise as wide as
 * the user dragged it, or else as its tabs ask.
 * @param {{ collapsed: boolean, chosen: number | null, tabs: Pick<PaneTab, 'room'>[] }} pane
 */
export const paneWanted = ({ collapsed, chosen, tabs }) => (collapsed ? RAIL_WIDTH : (chosen ?? roomWanted(tabs)));

/**
 * The pane's share of the window. A pane that was asked for a width keeps to it, and the
 * conversation has the rest: unless a tab is better with more, and then the pane has its
 * share of the rest too. Without a width, the two share the window.
 * @param {number} wanted  how wide its tabs, or the user, want it: 0 for no width at all
 * @param {boolean} grows  whether one of its tabs is better with more than that
 */
export const paneFlex = (wanted, grows) => (wanted ? `${grows ? 1 : 0} 1 ${wanted}px` : '');

/**
 * The conversation's share. Beside a pane that takes its share, it starts from the width
 * it has and takes the other share. Otherwise it has whatever the pane leaves.
 * @param {number} wanted
 * @param {boolean} grows
 * @param {number} width  the conversation's, as it is
 */
export const besideFlex = (wanted, grows, width) => (wanted && grows ? `1 1 ${width}px` : '');

/**
 * How wide a drag of the bar makes the pane: as far as the pointer went, between the
 * narrowest a pane gets and what the conversation can still give. A pane that a small
 * screen left narrower than that gets no narrower.
 * @param {{ pane: number, conversation: number, narrowest: number }} from  how wide the two were
 *   as the drag started, and how narrow the conversation gets
 * @param {number} by  how far the bar went towards the conversation
 */
export const draggedTo = ({ pane, conversation, narrowest }, by) =>
  Math.round(Math.max(Math.min(pane, PANE_MIN_WIDTH), Math.min(pane + by, widestFrom(pane, conversation, narrowest))));

/** Dragged, a half of the pane gets no shorter than this: room for its tabs and a few lines under them. */
const HALF_MIN_HEIGHT = 90;

/**
 * What share of the pane's height a drag of the bar between its halves leaves the lower one: as
 * far as the pointer went, with neither half shorter than a half gets. A half that a short window
 * left shorter than that gets no shorter.
 * @param {{ upper: number, lower: number }} from  how tall the halves were as the drag started
 * @param {number} by  how far the bar went up
 */
export function lowerShare({ upper, lower }, by) {
  const total = upper + lower;
  const least = Math.min(lower, HALF_MIN_HEIGHT);
  const most = Math.max(lower, total - HALF_MIN_HEIGHT);
  return Math.max(least, Math.min(lower + by, most)) / total;
}

// A window that goes on to another contact loads its page again. The width the pane was
// dragged to is kept for the window, so the pane is as wide there: until the window closes.
const CHOSEN = 'sidePaneWidth';

/** The width the pane was dragged to in this window, or null: as wide as its tabs ask. */
export function keptPaneWidth() {
  try {
    const width = Number(sessionStorage.getItem(CHOSEN));
    return width > 0 ? Math.round(width) : null;
  } catch {
    return null;
  }
}

/** @param {number | null} width  null once the pane is as wide as its tabs ask again */
export function keepPaneWidth(width) {
  try {
    if (width === null) sessionStorage.removeItem(CHOSEN);
    else sessionStorage.setItem(CHOSEN, String(width));
  } catch {
    // The next contact's pane is as wide as its tabs ask, then.
  }
}

// And whether it was collapsed: for the window, not the contact, so going on to another contact
// leaves the window as narrow as it was.
const COLLAPSED = 'sidePaneCollapsed';

/** Whether the pane was collapsed in this window: then the next contact's is too, until it is brought back out. */
export function keptCollapsed() {
  try {
    return sessionStorage.getItem(COLLAPSED) === 'true';
  } catch {
    return false;
  }
}

/** @param {boolean} collapsed */
export function keepCollapsed(collapsed) {
  try {
    if (collapsed) sessionStorage.setItem(COLLAPSED, 'true');
    else sessionStorage.removeItem(COLLAPSED);
  } catch {
    // The next contact's pane opens out, then.
  }
}

// And how the pane shared the window as the page went, if it was open. The window keeps the room
// it had, and the next page holds its place from its first picture until it knows what is open
// there (see `settle`): the window is not made narrower and wider again on the way.
const HELD = 'sidePaneHeld';

/**
 * How the pane shared the window as the last page in it went, or null: it was closed.
 * @returns {{ wanted: number, grows: boolean, conversation: number } | null}
 */
export function heldPane() {
  try {
    const held = JSON.parse(sessionStorage.getItem(HELD));
    const { wanted, grows, conversation } = held ?? {};
    if (!(wanted >= 0 && conversation > 0)) return null;
    return { wanted: Math.round(wanted), grows: grows === true, conversation: Math.round(conversation) };
  } catch {
    return null;
  }
}

/** @param {{ wanted: number, grows: boolean, conversation: number } | null} held  null for a pane that was closed */
export function holdPane(held) {
  try {
    if (held) sessionStorage.setItem(HELD, JSON.stringify(held));
    else sessionStorage.removeItem(HELD);
  } catch {
    // The next page opens its pane as a window without one does, then.
  }
}

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * What the pane had open the last time a window showed a contact, as far as it can be opened again: the app
 * keeps it with the rest of what the window had on show (see main/kept-views.js), for whichever window shows
 * the contact next. Coming back to the contact opens its tabs again (see `restore`).
 * @param {unknown} state  as it was kept
 * @returns {PaneState | null}  null when no window went on from the contact yet
 */
export function paneStateFrom(state) {
  if (!isRecord(state) || !Array.isArray(state.tabs)) return null;
  const id = (value) => (typeof value === 'string' ? value : null);
  return {
    tabs: state.tabs
      .filter((tab) => isRecord(tab) && typeof tab.id === 'string')
      .map((tab) => ({ ...tab, lower: tab.lower === true })),
    upper: id(state.upper),
    lower: id(state.lower),
    folded: state.folded === true,
    full: state.full === true,
  };
}

/** A tab has to be dragged this far sideways before it leaves its place: less is a click. */
const DRAG_SLACK = 6;

/**
 * Where a tab dragged to `x` lands: before the first tab whose middle is to the right of it.
 * @param {{ id: string, left: number, width: number }[]} tabs  the tabs as they are drawn, in order
 * @param {number} x
 * @returns {string | null}  the tab it lands before; null for after the last
 */
export const landsBefore = (tabs, x) => tabs.find((tab) => x < tab.left + tab.width / 2)?.id ?? null;

/**
 * The tabs with one of them moved to just before another, or to the end.
 * @param {string[]} ids  the tabs, in order
 * @param {string} id     the one that was dragged
 * @param {string | null} before
 */
export function moved(ids, id, before) {
  if (before === id || !ids.includes(id)) return ids;
  const rest = ids.filter((other) => other !== id);
  const at = rest.includes(before) ? rest.indexOf(before) : rest.length;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * The tabs with the pinned ones in front of the others in each half, in their order, as in a browser. `id`, a tab
 * just pinned or unpinned, goes between the two: last of the pinned, or first of the rest. Each half keeps the
 * places it had among the other half's tabs.
 * @template {{ id: string, lower?: boolean, pinned?: boolean }} T
 * @param {T[]} tabs  the tabs, in order
 * @param {string | null} [id]
 * @returns {T[]}
 */
export function pinnedFirst(tabs, id = null) {
  const [upper, lower] = [false, true].map((low) => {
    const half = tabs.filter((tab) => Boolean(tab.lower) === low);
    const rest = half.filter((tab) => tab.id !== id);
    return [
      ...rest.filter((tab) => tab.pinned),
      ...half.filter((tab) => tab.id === id),
      ...rest.filter((tab) => !tab.pinned),
    ];
  });
  return tabs.map((tab) => (tab.lower ? lower : upper).shift());
}

/**
 * Where a dragged tab lands among the tabs of its half: before the tab it was let go before, unless that is on the
 * other side of the pinned ones, which stay together in front. Then it lands at their edge.
 * @param {{ id: string, lower?: boolean, pinned?: boolean }[]} tabs  the half's tabs, in order
 * @param {string} id  the one dragged
 * @param {string | null} before  where it was let go, as `landsBefore` says
 * @returns {string | null}  the tab it lands before; null for after the last
 */
export function landsAt(tabs, id, before) {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  if (!byId.has(id)) return before;
  const order = pinnedFirst(moved([...byId.keys()], id, before).map((tabId) => byId.get(tabId)));
  return order[order.findIndex((tab) => tab.id === id) + 1]?.id ?? null;
}

/**
 * The tab to go to when the chosen one closes: the next one, or else the one before.
 * @param {string[]} ids  the tabs, in order
 * @param {string} id     the one closing
 */
export function neighbour(ids, id) {
  const at = ids.indexOf(id);
  return ids[at + 1] ?? ids[at - 1] ?? null;
}

/**
 * The tabs with the ones their halves keep, wherever a half has others: in front of those, in the
 * order they were kept. A half with nothing in it gets none of them, and stays closed.
 * @template {{ id: string, lower?: boolean, unavailable?: boolean }} T
 * @param {T[]} tabs  the tabs, in order
 * @param {T[]} kept  the tabs the halves keep, in order
 * @returns {T[]}
 */
export function withKept(tabs, kept) {
  const sameHalf = (a, b) => Boolean(a.lower) === Boolean(b.lower);
  const rank = (tab) => {
    const at = kept.findIndex((k) => k.id === tab.id);
    return at < 0 ? Infinity : at;
  };
  const result = [...tabs];
  for (const tab of kept) {
    if (result.some((t) => t.id === tab.id) || !result.some((t) => sameHalf(t, tab) && !t.unavailable)) continue;
    const at = result.findIndex((t) => sameHalf(t, tab) && rank(t) > rank(tab));
    result.splice(at < 0 ? result.length : at, 0, tab);
  }
  return result;
}

/**
 * What the + lists: the kinds of tab there are here, each with its shortcut, then
 * whatever else can be opened, the conversation's plans say. A kind that isn't
 * built is not among `kinds`, and one the browser preview can't run is left out there.
 * @param {PaneKind[]} kinds
 * @param {{ web?: boolean, more?: import('../lib/menu.js').MenuItem[] }} [opts]
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
export function addMenu(kinds, { web = false, more = [] } = {}) {
  const items = kinds
    .filter((kind) => !(web && kind.desktop))
    .map(({ label, icon, hint, open }) => ({ label, icon, hint, action: open }));
  return items.length && more.length ? [...items, { separator: true }, ...more] : [...items, ...more];
}

export class SidePane {
  /**
   * @param {HTMLElement} root
   * @param {object} opts
   * @param {HTMLElement} opts.beside  the conversation's column, which the pane takes no room from
   * @param {(width: number) => Promise<void>} opts.room  asks the window for `width` more room, or gives it back (0)
   * @param {(change: () => Promise<void>) => Promise<void>} [opts.around]  wraps the pane's opening and
   *   closing, e.g. to keep the conversation scrolled to the bottom
   * @param {{ title: string, action: (button: HTMLElement) => void }} [opts.add]  with it, a + follows the last
   *   tab: `action` is called with that button, to show under it what can be opened
   * @param {(ids: string[]) => void} [opts.reordered]  the user dragged a tab to another place, or pinned or unpinned
   *   one, which moves it: the tabs as they are now
   * @param {{ title: string, action: (button: HTMLElement) => void }} [opts.addLower]  the + of the lower half
   * @param {(id: string) => void} [opts.opened]  a tab that wasn't open is now, and not by itself: not as the
   *   window comes back to its contact, nor inside `quietly`
   */
  constructor(
    root,
    { beside, room, around = (change) => change(), add, addLower, reordered = () => {}, opened = () => {} }
  ) {
    this.root = root;
    this.beside = beside;
    this.room = room;
    this.around = around;
    this.reordered = reordered;
    this.opened = opened;
    /**
     * Called whenever what is on show may have changed: a tab opened, chosen or closed, or the pane collapsed
     * or brought back out. Set it once what it reads is there.
     * @type {() => void}
     */
    this.changed = () => {};
    /** Whether what comes back with the page is open (see `settle`). Until then, what opens leaves a collapsed pane as it is. */
    this.settled = false;
    /** Whether the pane stays open with no tab left: collapsing it is how it is put away then (see `settle`). */
    this.keepOpen = false;
    /** How many `quietly`s are going on: while any is, what opens is not said to have opened. */
    this.quiet = 0;
    /** @type {PaneTab[]} */
    this.tabs = [];
    /** @type {PaneTab[]} the tabs a half has whenever it has any (see `keep`) */
    this.kept = [];
    /** Whether the lower half is folded away, down to its tabs. */
    this.folded = false;
    /** How wide its tabs wanted the pane when the window was last asked for room. */
    this.given = 0;
    /** Whether one of them was better with more than that. */
    this.grew = false;
    /** @type {number | null} how wide the user dragged the pane, for as long as the window is open. Null: as wide as its tabs ask */
    this.chosen = keptPaneWidth();
    /** Whether the pane fills the window, over the conversation. */
    this.full = false;
    /** Whether it is collapsed to a rail at the window's side, its tabs out of sight. As the window had it. */
    this.collapsed = keptCollapsed();

    root.replaceChildren(
      el(
        `<div class="pane-frame">
          <div class="pane-half pane-upper">
            <div class="pane-bar">
              <div class="pane-tabs" role="tablist"></div>
              <button class="pane-add" type="button" hidden>+</button>
              <span class="spacer"></span>
              <button class="pane-fill" type="button"></button>
              <button class="pane-collapse" type="button">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m3.5 4 4 4-4 4M8.5 4l4 4-4 4"/>
                </svg>
              </button>
            </div>
            <div class="pane-body">
              <p class="pane-none" hidden>Nothing is open here. The + above opens files, changes, a web page and more.</p>
            </div>
          </div>
          <div class="pane-half pane-lower" hidden>
            <div class="pane-sash" role="separator" aria-orientation="horizontal"
              title="Drag to resize. Double-click to put it back."></div>
            <div class="pane-bar">
              <button class="pane-fold" type="button">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m4 6 4 4 4-4"/>
                </svg>
              </button>
              <div class="pane-tabs" role="tablist"></div>
              <button class="pane-add" type="button" hidden>+</button>
            </div>
            <div class="pane-body"></div>
          </div>
        </div>`
      )
    );
    /**
     * The two halves, each with the tab it shows. A tab says which it is in (`lower`).
     * @type {Record<'upper' | 'lower', { node: HTMLElement, strip: HTMLElement, body: HTMLElement, selected: string | null }>}
     */
    this.halves = Object.fromEntries(
      ['upper', 'lower'].map((name) => {
        const node = $(`.pane-${name}`, root);
        return [name, { node, strip: $('.pane-tabs', node), body: $('.pane-body', node), selected: null }];
      })
    );
    // The gap between the conversation's side and the pane, which it drags wider or narrower.
    this.splitter = el(
      `<div class="pane-splitter" role="separator" aria-orientation="vertical"
        title="Drag to resize. Double-click to put it back." hidden></div>`
    );
    root.before(this.splitter);
    this.#resizing();
    this.#resizingHalves();

    $('.pane-fill', root).addEventListener('click', () => this.toggleFull());
    this.#fill(false);
    $('.pane-collapse', root).addEventListener('click', () => this.toggleCollapsed());
    this.#paintCollapsed();
    // So does the rail's strip, under it.
    this.halves.upper.body.addEventListener('click', (e) => {
      if (this.collapsed && e.target === e.currentTarget) this.#collapse(false);
    });
    $('.pane-fold', root).addEventListener('click', () => this.#fold(!this.folded));
    this.#fold(false);
    for (const [half, adds] of [
      [this.halves.upper, add],
      [this.halves.lower, addLower],
    ]) {
      if (!adds) continue;
      const button = /** @type {HTMLButtonElement} */ ($('.pane-add', half.node));
      button.hidden = false;
      button.dataset.tip = adds.title;
      button.setAttribute('aria-label', adds.title);
      button.addEventListener('click', () => adds.action(button));
    }
    for (const { strip } of Object.values(this.halves)) this.#tabStrip(strip);

    // Where the last page in this window had the pane, it is from the first picture, empty until
    // `settle`: the window kept the room for it.
    const held = heldPane();
    if (held) {
      this.root.hidden = this.splitter.hidden = false;
      this.root.style.flex = this.#flex(held.wanted, held.grows);
      beside.style.flex = besideFlex(held.wanted, held.grows, held.conversation);
      this.given = held.wanted;
      this.grew = held.grows;
      this.#draw();
    }
    window.addEventListener('pagehide', () =>
      holdPane(
        this.root.hidden
          ? null
          : { wanted: this.given, grows: this.grew, conversation: beside.getBoundingClientRect().width }
      )
    );
  }

  /**
   * Call once what comes back with the page is open: its terminals, and what Run started. What
   * opens from now on brings a collapsed pane back out.
   * @param {{ keepOpen?: boolean }} [opts]  `keepOpen`: the pane is there from now on, also with no tab
   *   left. Without it, with nothing beside the conversation, the place held for the pane is the
   *   conversation's again, and the window gives back the room it kept for it
   */
  settle({ keepOpen = false } = {}) {
    this.settled = true;
    this.keepOpen = keepOpen;
    this.#draw();
    if (this.root.hidden && !keepOpen && !this.tabs.length) return void this.room(0);
    void this.#arrange();
  }

  /** What it has open now, to open again when the window comes back to this contact (see `restore`). @returns {PaneState} */
  get state() {
    return {
      tabs: this.tabs.map((tab) => ({
        ...tab.again?.(),
        id: tab.id,
        lower: Boolean(tab.lower),
        ...(tab.pinned && { pinned: true, title: tab.title }),
      })),
      upper: this.halves.upper.selected,
      lower: this.halves.lower.selected,
      folded: this.folded,
      full: this.full,
    };
  }

  /**
   * Opens again what it had open the last time the window showed this contact, in that order, and
   * goes to the tabs its halves showed. What came back with the page is there already: its
   * terminals, which go away again if their half had been put away.
   * @param {PaneState} state
   * @param {(tab: PaneState['tabs'][number]) => (void | string | Promise<void | string>)} reopen
   *   opens one of them with what its `again` said; returns its id if it generated a new one
   */
  async restore({ tabs, upper, lower, folded, full }, reopen) {
    /** @type {Map<string, string>} each kept tab's id, to the id of the tab open in its place: a web page's is new */
    const again = new Map();
    for (const tab of tabs) {
      const there = new Set(this.tabs);
      let created;
      let restored;
      this.quiet += 1;
      try {
        if (!this.has(tab.id)) {
          const result = reopen(tab);
          created = this.tabs.find((t) => !there.has(t))?.id;
          restored = await result;
        }
      } catch {
        // A missing file, page or provider must not prevent the remaining tabs restoring.
      } finally {
        this.quiet -= 1;
      }
      const candidate = typeof restored === 'string' ? restored : created;
      let opened = this.has(tab.id) ? tab.id : this.has(candidate) ? candidate : null;
      if (!opened && tab.pinned) {
        this.quietly(() => this.open(this.#unavailable(tab)));
        opened = tab.id;
      }
      if (opened) this.tabs.find((t) => t.id === opened).pinned = tab.pinned === true;
      if (opened) again.set(tab.id, opened);
    }
    if (!tabs.some((tab) => tab.lower)) this.closeLower();
    // In the order they had, with what opened since after them: a plan that waits for an answer. The pinned ones
    // are in front, also in a view saved before pins came first.
    const order = [...again.values()];
    const rank = (tab) => (order.includes(tab.id) ? order.indexOf(tab.id) : order.length);
    this.tabs = pinnedFirst(this.tabs.toSorted((a, b) => rank(a) - rank(b)));
    this.#draw();
    for (const id of [upper, lower]) if (again.has(id)) this.select(again.get(id));
    this.#fold(folded);
    // A pane the window collapsed stays so: it fills the window once it is brought back out.
    if (full && this.tabs.length && !this.collapsed) this.#fill(true);
  }

  /**
   * What a row of tabs does: a click goes to a tab or closes it, and a tab can be renamed and dragged.
   * With more tabs than it has room for, arrows at its ends scroll it.
   */
  #tabStrip(strip) {
    tabArrows(strip);
    const tabOf = (e) => /** @type {HTMLElement} */ (e.target).closest('.pane-tab')?.dataset.id;
    strip.addEventListener('click', (e) => {
      const id = tabOf(e);
      if (!id) return;
      if (/** @type {HTMLElement} */ (e.target).closest('.pane-tab-pin')) this.pin(id);
      else if (/** @type {HTMLElement} */ (e.target).closest('.pane-tab-close')) this.#dismiss(id);
      // The second click of a double-click. Not `dblclick`: that goes to the tab as it was
      // drawn before the first click chose it, which is no longer in the page.
      else if (e.detail === 2) this.#rename(id);
      else this.select(id);
    });
    // As in a browser: the middle button closes a tab, wherever on it.
    strip.addEventListener('auxclick', (e) => {
      if (e.button === 1 && tabOf(e)) this.#dismiss(tabOf(e));
    });
    strip.addEventListener('keydown', (e) => {
      const id = tabOf(e);
      if (!id || e.target.closest('button, input')) return;
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const tabs = $$('.pane-tab', strip);
        const at = tabs.findIndex((tab) => tab.dataset.id === id);
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : (at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        this.select(tabs[next].dataset.id);
        $$('.pane-tab', strip)[next]?.focus();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        this.#dismiss(id);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.select(id);
      }
    });
    strip.addEventListener('contextmenu', (e) => {
      const tab = this.tabs.find((t) => t.id === tabOf(e));
      if (!tab) return;
      const items = tabMenu(tab, this.#keeps(tab.id), {
        rename: () => this.#rename(tab.id),
        close: () => this.#dismiss(tab.id),
        pin: () => this.pin(tab.id),
      });
      if (!items.length) return;
      e.preventDefault();
      openMenu({ x: e.clientX, y: e.clientY }, items);
    });
    strip.addEventListener('pointerdown', (e) => this.#grab(e, strip));
  }

  /** @param {string} id */
  has(id) {
    return this.tabs.some((tab) => tab.id === id);
  }

  /**
   * Pins a tab, or takes its pin off, without going to it. As in a browser, the pinned tabs are in front of the
   * others in their half: one just pinned goes after them, one unpinned first of the rest, and it is brought into
   * sight there.
   */
  pin(id) {
    const tab = this.tabs.find((tab) => tab.id === id);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    if (!tab.pinned && tab.unavailable) return void this.close(id);
    const order = this.tabs.map((tab) => tab.id);
    this.tabs = pinnedFirst(this.tabs, id);
    this.#draw();
    // From the start of the row: the pinned tabs with it, as many as there is room for.
    const { strip } = this.#halfOf(tab);
    strip.scrollLeft = 0;
    $$('.pane-tab', strip)
      .find((node) => node.dataset.id === id)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const ids = this.tabs.map((tab) => tab.id);
    if (ids.join() !== order.join()) this.reordered(ids);
  }

  #unavailable(tab) {
    return {
      id: tab.id,
      title: tab.title || 'Unavailable tab',
      lower: tab.lower,
      pinned: true,
      unavailable: true,
      icon: smallIcon.pin(),
      body: el(
        html`<div class="pane-unavailable">
          <p>${tab.title || 'This tab'} is no longer available in this conversation.</p>
          <p>Unpin this tab to remove it. Open available content from the + above.</p>
        </div>`
      ),
      again: () => ({ ...tab.again?.(), ...tab }),
    };
  }

  /**
   * Has `tab` in its half whenever that half is open: it comes with the first of the half's other
   * tabs, in front of them, and has no ✕. Putting the half away, or the whole pane, takes it along.
   * @param {PaneTab} tab
   */
  keep(tab) {
    this.kept.push(tab);
  }

  /** Whether a tab is one its half keeps. @param {string} id */
  #keeps(id) {
    return this.kept.some((tab) => tab.id === id);
  }

  /** The half a tab is in. @param {Pick<PaneTab, 'lower'>} tab */
  #halfOf(tab) {
    return tab.lower ? this.halves.lower : this.halves.upper;
  }

  /** The tabs of one half, in order. */
  #tabsOf(half) {
    return this.tabs.filter((tab) => this.#halfOf(tab) === half);
  }

  /** The tab the upper half shows: what there is to look at beside the conversation. None while the pane is collapsed. */
  get selected() {
    return this.collapsed ? null : this.halves.upper.selected;
  }

  /** Whether a tab is the one its half shows. None is while the pane is collapsed. @param {string} id */
  shows(id) {
    return !this.collapsed && Object.values(this.halves).some((half) => half.selected === id);
  }

  /** Opens a tab and goes to it. One that is open already is only gone to. @param {PaneTab} tab */
  open(tab) {
    const there = new Set(this.tabs);
    const fresh = !this.has(tab.id);
    const previous = this.tabs.find((t) => t.id === tab.id && t.unavailable);
    if (previous) {
      tab.pinned = previous.pinned;
      previous.body.replaceWith(tab.body);
      this.tabs[this.tabs.indexOf(previous)] = tab;
    }
    // The tabs its half keeps come with it, behind the half's pinned ones.
    this.tabs = pinnedFirst(withKept(fresh ? [...this.tabs, tab] : this.tabs, this.kept));
    for (const added of this.tabs) if (!there.has(added)) this.#halfOf(added).body.appendChild(added.body);
    this.select(tab.id);
    this.#arrange();
    if (fresh && !this.quiet) this.opened(tab.id);
  }

  /**
   * Does what `open` does without any tab it opens being said to have opened: for what the window
   * opens by itself, as a new worktree's tabs.
   * @template T
   * @param {() => T} open
   * @returns {T}
   */
  quietly(open) {
    this.quiet += 1;
    try {
      return open();
    } finally {
      this.quiet -= 1;
    }
  }

  /** @param {string} id */
  select(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    // What was asked for is shown: a lower half that was folded away comes back up.
    if (tab.lower && this.folded) this.#fold(false);
    const half = this.#halfOf(tab);
    // And a collapsed pane comes back out. Not for what comes back with the page, or opens by itself.
    if (this.collapsed && this.settled && !this.quiet) {
      half.selected = id;
      this.#collapse(false);
    } else this.#choose(half, id);
  }

  /** Folds the lower half away, down to its tabs, or brings it back. */
  #fold(folded) {
    this.folded = folded;
    this.halves.lower.node.classList.toggle('folded', folded);
    const button = $('.pane-fold', this.root);
    const title = folded ? 'Show what runs here' : 'Fold this away';
    button.dataset.tip = title;
    button.setAttribute('aria-label', title);
    button.setAttribute('aria-expanded', String(!folded));
  }

  /** A tab is called something else from now on: a web page's, once it says what it is. @param {string} id @param {string} title */
  retitle(id, title) {
    const tab = this.tabs.find((t) => t.id === id);
    // Not while its title is being typed over: that would be thrown away.
    if (!tab || tab.title === title || $('.pane-tab-rename', this.root)) return;
    tab.title = title;
    this.#draw();
  }

  /** @param {string} id */
  close(id, { unavailable = false } = {}) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.pinned) {
      if (unavailable) {
        const replacement = this.#unavailable({ ...tab.again?.(), id, title: tab.title, lower: tab.lower });
        this.tabs[this.tabs.indexOf(tab)] = replacement;
        tab.body.replaceWith(replacement.body);
        this.#draw();
      }
      return;
    }
    const half = this.#halfOf(tab);
    // The tab that takes its place is one of its own half.
    const ids = this.#tabsOf(half).map((t) => t.id);
    this.tabs = this.tabs.filter((t) => t !== tab);
    tab.body.remove();
    this.#choose(half, half.selected === id ? neighbour(ids, id) : half.selected);
    this.#arrange();
  }

  /** Puts the lower half away, with every tab in it. What runs there goes on, and comes back with the half. */
  closeLower() {
    const tabs = this.#tabsOf(this.halves.lower);
    const stays = tabs.some((tab) => tab.pinned);
    const lower = tabs.filter((tab) => !tab.pinned && !(stays && this.#keeps(tab.id)));
    for (const tab of lower) tab.body.remove();
    this.tabs = this.tabs.filter((tab) => !lower.includes(tab));
    this.halves.lower.selected =
      this.#tabsOf(this.halves.lower).find((tab) => tab.id === this.halves.lower.selected)?.id ??
      this.#tabsOf(this.halves.lower)[0]?.id ??
      null;
    this.#draw();
    this.#arrange();
  }

  /**
   * The user closed a tab themselves: what it stands for may end with it. A tab its half keeps
   * is not theirs to close.
   * @param {string} id
   */
  #dismiss(id) {
    if (this.#keeps(id)) return;
    const tab = this.tabs.find((tab) => tab.id === id);
    if (tab) tab.pinned = false;
    tab?.onClose?.();
    this.close(id);
  }

  /**
   * Lets the user type another title for a tab, where its title is. Enter, or clicking
   * elsewhere, keeps what was typed; Esc leaves the tab as it was.
   * @param {string} id
   */
  #rename(id) {
    const tab = this.tabs.find((t) => t.id === id);
    const title = $(`.pane-tab[data-id="${CSS.escape(id)}"] .pane-tab-title`, this.root);
    if (!tab?.rename || !title) return;
    const input = /** @type {HTMLInputElement} */ (
      el(html`<input class="pane-tab-rename" value="${tab.title}" aria-label="Name of this tab" spellcheck="false" />`)
    );
    title.replaceWith(input);
    input.select();
    let over = false;
    const finish = (keep) => {
      if (over) return;
      over = true;
      if (keep) tab.title = tab.rename(input.value);
      this.#draw();
    };
    input.addEventListener('keydown', (e) => {
      // Typed into the name, not at the tab or the window: a space is a space, and Esc is no nudge.
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    for (const type of ['click', 'dblclick', 'pointerdown']) input.addEventListener(type, (e) => e.stopPropagation());
  }

  /**
   * A tab held and dragged sideways takes another place among the tabs. Let go where it
   * was picked up, it was only clicked.
   * @param {PointerEvent} e
   * @param {HTMLElement} strip  the row of tabs it is in: a tab stays in its half
   */
  #grab(e, strip) {
    const held = /** @type {HTMLElement} */ (e.target).closest('.pane-tab');
    if (e.button !== 0 || !held || /** @type {HTMLElement} */ (e.target).closest('button, input')) return;
    const id = /** @type {HTMLElement} */ (held).dataset.id;
    // Among the tabs of its own half. The other half's stay as they are, after or before them.
    const half = Object.values(this.halves).find((h) => h.strip === strip);
    const from = e.clientX;
    let dragging = false;
    /** @type {string | null} */
    let before = id;
    const unmark = () => {
      for (const tab of $$('.pane-tab', strip)) tab.classList.remove('dragged', 'lands-before', 'lands-after');
    };
    const move = (/** @type {PointerEvent} */ at) => {
      if (!dragging && Math.abs(at.clientX - from) < DRAG_SLACK) return;
      dragging = true;
      const tabs = $$('.pane-tab', strip);
      // On its own side of the pinned tabs.
      before = landsAt(
        this.#tabsOf(half),
        id,
        landsBefore(
          tabs.map((tab) => ({ id: tab.dataset.id, ...tab.getBoundingClientRect().toJSON() })),
          at.clientX
        )
      );
      unmark();
      held.classList.add('dragged');
      // A line where it would land: before a tab, or after the last one.
      const target = tabs.find((tab) => tab.dataset.id === before);
      if (target) target.classList.add('lands-before');
      else tabs.at(-1)?.classList.add('lands-after');
    };
    const drop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', drop);
      unmark();
      if (!dragging) return;
      const ids = this.#tabsOf(half).map((tab) => tab.id);
      const next = moved(ids, id, before);
      if (next.join() === ids.join()) return;
      const others = this.tabs.filter((tab) => this.#halfOf(tab) !== half);
      const mine = next.map((tabId) => this.tabs.find((tab) => tab.id === tabId));
      this.tabs = half === this.halves.upper ? [...mine, ...others] : [...others, ...mine];
      this.#draw();
      this.reordered(this.tabs.map((tab) => tab.id));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
  }

  // ---- how much of the window it has -------------------------------------------------------------

  /** The pane's own button: over the whole window, and back beside the conversation. */
  toggleFull() {
    this.#fill(!this.full);
  }

  /** Its other button: down to a rail at the window's side, and back out. */
  toggleCollapsed() {
    this.#collapse(!this.collapsed);
  }

  /**
   * Collapses the pane to a rail at the window's side, or brings it back out, for every contact the
   * window goes on to. Its tabs stay as they were, out of sight, and the window gives back the room
   * they had. Brought back out, the tab each half shows is told it is on show again.
   * @param {boolean} collapsed
   */
  #collapse(collapsed) {
    if (collapsed === this.collapsed) return;
    if (collapsed && this.full) this.#fill(false);
    this.collapsed = collapsed;
    keepCollapsed(collapsed);
    this.#paintCollapsed();
    this.#draw();
    void this.#arrange();
    if (collapsed) return;
    for (const half of Object.values(this.halves)) this.tabs.find((tab) => tab.id === half.selected)?.onSelect?.();
  }

  #paintCollapsed() {
    this.root.classList.toggle('collapsed', this.collapsed);
    const button = $('.pane-collapse', this.root);
    const title = this.collapsed ? 'Expand the side pane' : 'Collapse the side pane';
    button.dataset.tip = title;
    button.setAttribute('aria-label', title);
    button.setAttribute('aria-expanded', String(!this.collapsed));
  }

  /** How the pane shares the window: a collapsed one keeps to its rail. @param {number} wanted @param {boolean} grows */
  #flex(wanted, grows) {
    return this.collapsed ? `0 0 ${RAIL_WIDTH}px` : paneFlex(wanted, grows);
  }

  /**
   * Has the pane fill the window, or puts it back. The conversation keeps its place
   * underneath, out of sight: it is as wide as before when it is seen again, and where it was.
   * @param {boolean} full
   */
  #fill(full) {
    this.full = full;
    const main = this.root.parentElement;
    main.classList.toggle('pane-full', full);
    // What is under the pane is not there to be clicked, or typed into.
    for (const other of main.children) if (other !== this.root) other.inert = full;
    const button = $('.pane-fill', this.root);
    const title = full ? 'Put the side pane back beside the conversation' : 'Fill the window with the side pane';
    button.innerHTML = full ? smallIcon.unfill() : smallIcon.fill();
    button.dataset.tip = title;
    button.setAttribute('aria-label', title);
    button.setAttribute('aria-pressed', String(full));
  }

  /** The bar dragged sideways makes the pane as wide as it is dragged. A double-click puts it back as its tabs ask. */
  #resizing() {
    const bar = this.splitter;
    /** How wide the two are, and how narrow the conversation gets. */
    const widths = () => ({
      pane: this.root.getBoundingClientRect().width,
      conversation: this.beside.getBoundingClientRect().width,
      narrowest: parseFloat(getComputedStyle(this.beside).minWidth) || 0,
    });
    /** @type {(ReturnType<typeof widths> & { x: number }) | null} where the drag started */
    let from = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // or the drag selects the conversation's text
      bar.setPointerCapture(e.pointerId); // so the bar is followed wherever the pointer goes
      bar.classList.add('dragging');
      from = { x: e.clientX, ...widths() };
    });
    bar.addEventListener('pointermove', (e) => {
      // The pane is on the right, so dragging left makes it wider. A click that moved nowhere is no drag.
      if (!from || e.clientX === from.x) return;
      this.chosen = draggedTo(from, from.x - e.clientX);
      this.#share(this.chosen, from);
    });
    const done = () => {
      if (!from) return;
      from = null;
      bar.classList.remove('dragging');
      keepPaneWidth(this.chosen);
    };
    bar.addEventListener('pointerup', done);
    bar.addEventListener('pointercancel', done);
    bar.addEventListener('dblclick', () => {
      this.chosen = null;
      keepPaneWidth(null);
      this.#share(roomWanted(this.tabs), widths());
    });
  }

  /**
   * The lower half's top edge dragged up or down shares the pane's height between the halves, for
   * as long as the window is open. A double-click puts it back as it was.
   */
  #resizingHalves() {
    const { upper, lower } = this.halves;
    const sash = $('.pane-sash', lower.node);
    /** @type {{ y: number, upper: number, lower: number } | null} where the drag started */
    let from = null;
    sash.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // or the drag selects what the pane shows
      sash.setPointerCapture(e.pointerId);
      sash.classList.add('dragging');
      from = {
        y: e.clientY,
        upper: upper.node.getBoundingClientRect().height,
        lower: lower.node.getBoundingClientRect().height,
      };
    });
    sash.addEventListener('pointermove', (e) => {
      // Dragging up makes the lower half taller.
      if (!from || e.clientY === from.y) return;
      this.root.style.setProperty('--lower-share', String(lowerShare(from, from.y - e.clientY)));
    });
    const done = () => {
      from = null;
      sash.classList.remove('dragging');
    };
    sash.addEventListener('pointerup', done);
    sash.addEventListener('pointercancel', done);
    sash.addEventListener('dblclick', () => this.root.style.removeProperty('--lower-share'));
  }

  /**
   * Gives the pane a width within the window as it is: what the pane gains, the conversation
   * gives, and the other way round. The window is asked for nothing.
   * @param {number} wanted  how wide the pane is from now on: 0 to share the window
   * @param {{ pane: number, conversation: number }} from  how wide the two are
   */
  #share(wanted, from) {
    this.given = wanted;
    this.root.style.flex = paneFlex(wanted, this.grew);
    this.beside.style.flex = besideFlex(wanted, this.grew, from.pane + from.conversation - wanted);
  }

  /**
   * Has a half go to one of its tabs, or to none. One that was not the chosen one before is told that
   * it is now: once the pane is brought back out, if it is collapsed.
   */
  #choose(half, id) {
    const changed = id !== half.selected;
    half.selected = id;
    this.#draw();
    if (changed && !this.collapsed) this.tabs.find((tab) => tab.id === id)?.onSelect?.();
  }

  #draw() {
    for (const half of Object.values(this.halves)) this.#drawHalf(half);
    const { upper, lower } = this.halves;
    const [above, below] = [this.#tabsOf(upper).length, this.#tabsOf(lower).length];
    // With nothing in either half, the upper one says how to open something: once what comes back
    // with the page is open, and not while it is on its way.
    const bare = this.settled && !above && !below;
    // A half with nothing in it leaves its room to the other. The upper one keeps its bar: the
    // buttons that fill the window with the pane, and collapse it, are on it.
    lower.node.hidden = !below;
    upper.node.classList.toggle('empty', !above && !bare);
    $('.pane-none', upper.body).hidden = !bare;
    this.changed();
  }

  // Every tab's contents stay in the page, hidden: taken out, they would forget how far they were scrolled.
  #drawHalf(half) {
    const tabs = this.#tabsOf(half);
    const focused = half.strip.contains(document.activeElement) ? document.activeElement : null;
    const focusedId = focused?.closest('.pane-tab')?.dataset.id;
    const focusedPin = focused?.classList.contains('pane-tab-pin');
    half.strip.replaceChildren(
      ...tabs.map((tab) => {
        const chosen = tab.id === half.selected;
        // A tab its half keeps has no ✕: it is there for as long as the half is.
        const close =
          this.#keeps(tab.id) || tab.pinned
            ? ''
            : html`<button class="pane-tab-close" type="button" tabindex="-1" aria-label="Close ${tab.title}">
                ✕
              </button>`;
        return el(
          html`<div
            class="pane-tab${chosen ? ' selected' : ''}${tab.pinned ? ' pinned' : ''}"
            role="tab"
            tabindex="0"
            aria-selected="${String(chosen)}"
            aria-label="${tab.title}${tab.pinned ? ', pinned' : ''}"
            data-id="${tab.id}"
            title="${tab.title}"
          >
            ${raw(tab.icon)}<span class="pane-tab-title">${tab.title}</span>
            <button
              class="pane-tab-pin"
              type="button"
              aria-label="${tab.pinned ? 'Unpin' : 'Pin'} ${tab.title} tab"
              aria-pressed="${String(Boolean(tab.pinned))}"
              title="${tab.pinned ? 'Unpin tab' : 'Pin tab — keep it available in this conversation'}"
            >
              ${raw(smallIcon.pin())}</button
            >${close}
          </div>`
        );
      })
    );
    for (const tab of tabs) tab.body.hidden = tab.id !== half.selected;
    if (focusedId) {
      const node =
        $$('.pane-tab', half.strip).find((tab) => tab.dataset.id === focusedId) ?? $('.pane-tab.selected', half.strip);
      (focusedPin && node ? $('.pane-tab-pin', node) : node)?.focus({ preventScroll: true });
    }
    $('.pane-tab.selected', half.strip)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /**
   * Shows the pane while it has a tab, as wide as its tabs need it. The window is what
   * changes size: the conversation is held at its width until the window has, so its lines
   * don't wrap and unwrap on the way.
   */
  async #arrange() {
    const open = this.tabs.length > 0 || this.keepOpen;
    // Where the user dragged it is where it stays, whatever its tabs ask for.
    const wanted = paneWanted(this);
    const grows = !this.collapsed && this.tabs.some((tab) => tab.grows);
    // With nothing left to show, the window is the conversation's again.
    if (!this.tabs.length && this.full) this.#fill(false);
    if (open === !this.root.hidden && wanted === this.given && grows === this.grew) return;
    await this.around(async () => {
      const { width } = this.beside.getBoundingClientRect();
      // The bar is as wide as the gap, on show or not.
      const gap = parseFloat(getComputedStyle(this.splitter).width) || 0;
      this.beside.style.flex = `0 0 ${width}px`;
      this.root.hidden = this.splitter.hidden = !open;
      this.root.style.flex = this.#flex(wanted, grows);
      this.given = wanted;
      this.grew = grows;
      try {
        await this.room(open ? (wanted || Math.min(width, MAX_ROOM)) + gap : 0);
      } finally {
        this.beside.style.flex = open ? besideFlex(wanted, grows, width) : '';
      }
    });
  }
}
