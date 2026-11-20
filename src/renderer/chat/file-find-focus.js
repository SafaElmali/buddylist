// File tabs alone claim Find here. List tabs keep their own search routing.
export class FileFindFocus {
  #last = null;

  /** The last focus or pointer interaction wins. Menus retain the place they opened from. */
  remember(node) {
    // A menu or palette keeps the scope it opened from. Conversation Find, opened while a file had focus, is a
    // place of its own: Find again stays in it.
    if (!node?.closest || node.closest('.popup, .menubar, .modal')) return;
    this.#last = node;
  }

  /** @param {Element | null} node @param {{ id: string, body: HTMLElement }[]} tabs */
  target(node, tabs) {
    const from = this.#last ?? node;
    const body = from?.closest?.('.file-tab');
    const id = from?.closest?.('.pane-tab')?.dataset.id;
    const tab = tabs.find((one) => one.body === body || (id?.startsWith('file:') && one.id === id));
    if (!tab || tab.body.closest('[hidden], [inert], .collapsed')) return null;
    return tab.body;
  }
}
