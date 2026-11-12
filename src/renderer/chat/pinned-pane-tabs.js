// Pins belong to a contact, like its saved pane view. Only the pins survive an
// app restart; ordinary tabs still use KeptViews. Store descriptors, never content.
const PREFIX = 'pinnedPaneTabs:';

/** Keep only the fields the pane knows how to reopen. */
export function pinnedTabsFrom(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((tab) => {
    if (!tab || typeof tab.id !== 'string' || !tab.id || seen.has(tab.id)) return [];
    seen.add(tab.id);
    const result = { id: tab.id, lower: tab.lower === true, pinned: true };
    for (const field of ['title', 'url', 'file', 'planFile']) {
      if (typeof tab[field] === 'string') result[field] = tab[field];
    }
    if (Number.isFinite(tab.top) && tab.top >= 0) result.top = tab.top;
    if (tab.plain === true) result.plain = true;
    return [result];
  });
}

/**
 * Merge pins into an ordinary view: the pinned tabs come first, in the order they were pinned, with what the view
 * has of them now, then its other tabs in their order. Pins an earlier version saved with a place among the other
 * tabs come first the same way, in their saved order.
 */
export function withPinnedTabs(state, pins) {
  const tabs = state.tabs.map(({ pinned: _pinned, ...rest }) => rest);
  const pinned = pins.map((pin) => ({ ...pin, ...tabs.find((tab) => tab.id === pin.id), pinned: true }));
  return { ...state, tabs: [...pinned, ...tabs.filter((tab) => !pins.some((pin) => pin.id === tab.id))] };
}

export class PinnedPaneTabs {
  /**
   * @param {string} contactId
   * @param {{ saved?: () => void }} [on]  `saved`: the pins changed in storage, which the browser writes to disk only
   *   seconds later: this has it write them now, so that a crash just after keeps them too
   */
  constructor(contactId, { saved = () => {} } = {}) {
    this.key = PREFIX + contactId;
    this.saved = saved;
  }

  read() {
    try {
      return pinnedTabsFrom(JSON.parse(localStorage.getItem(this.key)));
    } catch {
      return [];
    }
  }

  /** Said with each change of the pane: only a change of its pins is stored. */
  keep(state) {
    try {
      const tabs = pinnedTabsFrom(state.tabs.filter((tab) => tab.pinned));
      const pins = tabs.length ? JSON.stringify(tabs) : null;
      if (localStorage.getItem(this.key) === pins) return;
      if (pins) localStorage.setItem(this.key, pins);
      else localStorage.removeItem(this.key);
    } catch {
      // Storage can be unavailable. The current pane still keeps its pins.
      return;
    }
    this.saved();
  }
}
