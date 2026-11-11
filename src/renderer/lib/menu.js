// XP-style drop-down menus and popovers, shared by the menu bar, toolbars
// and right-click menus.
import { el, escapeHtml, html, raw } from './dom.js';
import { smallIcon } from './icons.js';

/**
 * @typedef {Object} MenuItem
 * @property {string} [label]
 * @property {string} [hint]       right-aligned text, e.g. a shortcut
 * @property {string} [key]        a lowercase letter that chooses the item while its menu is open, shown
 *   where the hint goes when it has none
 * @property {string} [icon]     trusted markup: an SVG, or an app's own icon
 * @property {string} [title]    said when it is pointed at
 * @property {string} [ariaLabel]  what a screen reader says of it, where that is more than its label and hint
 * @property {boolean} [checked]    a tick in place of the icon; an item with an icon keeps it, with the tick at its end
 * @property {boolean} [disabled]
 * @property {boolean} [note]     `label` is a line about the rows, read and never chosen: no row, so the mouse and
 *   the keys go past it. Greyed out in the Mac's menu bar
 * @property {boolean} [bold]
 * @property {boolean} [danger]
 * @property {boolean} [separator]
 * @property {() => void} [action]
 * @property {MenuItem[]} [submenu]  choosing the item shows these in its place
 * @property {readonly string[]} [keywords]  other words the palette (⌘K) finds it by: see KEYWORDS in shared/palette.js
 * @property {string} [role]  what Electron does itself in the Mac's menu bar, such as 'copy' or 'close' (see ROLES
 *   in shared/native-menus.js). In the window's own menus `action` does it
 */

/**
 * A box over a menu to narrow its items down by typing.
 * @typedef {Object} MenuSearch
 * @property {string} label  what is searched for, written in the box while it is empty
 * @property {(sought: string) => MenuItem[]} find  the items for what is typed. Never asked about an
 *   empty box: the menu's own items are shown for that
 */

let current = null;

export function closeMenu() {
  if (!current) return;
  const { node, onClose } = current;
  current = null;
  node.remove();
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', closeMenu);
  onClose?.();
}

function onOutside(e) {
  if (current && !current.node.contains(e.target) && !current.anchor?.contains(e.target)) closeMenu();
}

/**
 * The row an arrow key goes to: from the last row round to the first and back, and from no
 * row yet, Down to the first and Up to the last.
 * @param {number} index  the row that is highlighted; -1 for none
 * @param {number} count  how many rows can be chosen
 * @param {boolean} down
 * @returns {number}
 */
export const stepTo = (index, count, down) =>
  index < 0 && !down ? count - 1 : (index + (down ? 1 : -1) + count) % count;

/**
 * The letter a key press could choose a row by: none while a modifier is held, as those are the
 * window's own shortcuts.
 * @param {{ key: string, ctrlKey: boolean, metaKey: boolean, altKey: boolean }} e
 * @returns {string | null}
 */
export const pressedLetter = ({ key, ctrlKey, metaKey, altKey }) =>
  key.length === 1 && !ctrlKey && !metaKey && !altKey ? key.toLowerCase() : null;

function onKey(e) {
  // While an input method puts a word together, Enter and Escape are for it.
  if (!current || e.isComposing) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    return;
  }
  // A row's own letter chooses it, as a click does. In a menu with a search box, letters are typed there.
  const letter = pressedLetter(e);
  if (letter && !current.node.querySelector('.menu-search')) {
    const rows = [...current.node.querySelectorAll('.menu-item[data-key]:not(.disabled)')];
    const row = rows.find((r) => r.dataset.key === letter);
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    row.click();
    return;
  }
  // ← goes back from a submenu to the menu it was opened from, and → opens the one under the arrows.
  const active = current.node.querySelector('.menu-item.active');
  const back = current.node.querySelector('.menu-back');
  if ((e.key === 'ArrowLeft' && back) || (e.key === 'ArrowRight' && active?.classList.contains('has-submenu'))) {
    e.preventDefault();
    (e.key === 'ArrowLeft' ? back : active).click();
    current?.node.querySelector('.menu-item:not(.disabled)')?.classList.add('active');
    return;
  }
  const items = [...current.node.querySelectorAll('.menu-item:not(.disabled)')];
  if (!items.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
  e.preventDefault();
  if (e.key === 'Enter') {
    active?.click();
    return;
  }
  const next = items[stepTo(items.indexOf(active), items.length, e.key === 'ArrowDown')];
  active?.classList.remove('active');
  next.classList.add('active');
  // A long menu scrolls.
  next.scrollIntoView({ block: 'nearest' });
}

/** @typedef {{ left: number, right: number, top: number, bottom: number }} Rect  in the window */

/** @param {Element | { x: number, y: number }} anchor @returns {Rect} */
const rectOf = (anchor) =>
  anchor instanceof Element
    ? anchor.getBoundingClientRect()
    : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };

/**
 * Where a popover goes against `rect`: under it, or over it where there is no room, and inside the window.
 * @param {Rect} rect
 * @param {{ width: number, height: number }} size  the popover's
 * @param {{ width: number, height: number }} view  the window's
 * @param {{ align?: 'left' | 'right', above?: boolean }} [opts]
 * @returns {{ left: number, top: number }}
 */
export function place(rect, { width: w, height: h }, view, { align, above } = {}) {
  let left = align === 'right' ? rect.right - w : rect.left;
  let top = rect.bottom + 1;
  if (above || top + h > view.height - 4) top = Math.max(4, rect.top - h - 1);
  left = Math.min(Math.max(2, left), view.width - w - 2);
  return { left, top };
}

/**
 * Put a popover against its anchor: under it, or over it where there is no room.
 * Again after what is in the popover changed size.
 * @param {HTMLElement} node
 * @param {Element | { x: number, y: number }} anchor
 * @param {{ align?: 'left' | 'right', above?: boolean, rect?: Rect }} [opts]
 *   `rect`: a part of the anchor to put it against instead, such as a word in a box
 */
export function position(node, anchor, { align, above, rect = rectOf(anchor) } = {}) {
  const size = { width: node.offsetWidth, height: node.offsetHeight };
  const { left, top } = place(rect, size, { width: window.innerWidth, height: window.innerHeight }, { align, above });
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

/**
 * Show arbitrary content in a popover next to `anchor`.
 * @param {Element | { x: number, y: number }} anchor
 * @param {HTMLElement} content
 * @param {{ align?: 'left' | 'right', above?: boolean, rect?: Rect, className?: string, onClose?: () => void }} [opts]
 *   `above`: over the anchor even where there is room under it, as for what belongs to the message box.
 *   `rect`: a part of the anchor to put it against (see position). A click in the rest of the anchor still
 *   leaves it open
 */
export function openPopover(anchor, content, { align = 'left', above = false, rect, className = '', onClose } = {}) {
  closeMenu();
  const node = el(`<div class="popup ${className}" role="menu"></div>`);
  node.appendChild(content);
  document.body.appendChild(node);
  position(node, anchor, { align, above, rect });
  current = { node, anchor: anchor instanceof Element ? anchor : null, onClose };
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeMenu);
  return node;
}

/**
 * @param {MenuItem[]} items
 * @param {(submenu: MenuItem[], from: MenuItem) => void} showSubmenu
 * @param {{ label: string, go: () => void } | null} [back]  in a submenu: a row with its name on top, which goes
 *   back to the menu it was opened from
 */
function menuList(items, showSubmenu, back = null) {
  const list = el(`<div class="menu${items.length > 18 ? ' menu-scroll' : ''}"></div>`);
  if (back) {
    const row = el(
      `<div class="menu-item menu-back" role="menuitem"><span class="menu-check">‹</span><span class="menu-label">${escapeHtml(back.label)}</span><span class="menu-hint"></span></div>`
    );
    row.addEventListener('mouseenter', () => {
      list.querySelector('.menu-item.active')?.classList.remove('active');
      row.classList.add('active');
    });
    row.addEventListener('click', back.go);
    list.append(row, el('<div class="menu-sep"></div>'));
  }
  for (const item of items) {
    if (item.separator) {
      list.appendChild(el('<div class="menu-sep"></div>'));
      continue;
    }
    if (item.note) {
      list.appendChild(el(html`<div class="menu-note" role="presentation">${item.label}</div>`));
      continue;
    }
    const classes = [
      'menu-item',
      item.disabled && 'disabled',
      item.bold && 'bold',
      item.danger && 'danger',
      item.submenu && 'has-submenu',
    ]
      .filter(Boolean)
      .join(' ');
    const tickAtEnd = Boolean(item.checked && item.icon);
    const row = el(`<div class="${classes}" role="menuitem">
      <span class="menu-check">${item.checked && !tickAtEnd ? '✓' : item.icon || ''}</span>
      <span class="menu-label">${escapeHtml(item.label)}</span>
      <span class="menu-hint">${item.submenu ? '▸' : tickAtEnd ? '✓' : escapeHtml(item.hint || item.key?.toUpperCase() || '')}</span>
    </div>`);
    if (item.title) row.title = item.title;
    if (item.ariaLabel) row.setAttribute('aria-label', item.ariaLabel);
    if (item.disabled) row.setAttribute('aria-disabled', 'true');
    if (item.key) {
      row.dataset.key = item.key;
      row.setAttribute('aria-keyshortcuts', item.key.toUpperCase());
    }
    if (!item.disabled) {
      row.addEventListener('mouseenter', () => {
        list.querySelector('.menu-item.active')?.classList.remove('active');
        row.classList.add('active');
      });
      row.addEventListener('click', () => {
        if (item.submenu) return showSubmenu(item.submenu, item);
        closeMenu();
        item.action?.();
      });
    }
    list.appendChild(row);
  }
  return list;
}

/**
 * @param {Element | { x: number, y: number }} anchor
 * @param {MenuItem[]} items
 * @param {{ align?: 'left' | 'right', above?: boolean, rect?: Rect, className?: string, onClose?: () => void, search?: MenuSearch }} [opts]
 *   `search`: a box over the items to narrow them down by typing. `rect`: as for openPopover
 */
export function openMenu(anchor, items, { search, ...opts } = {}) {
  // A submenu takes over the open menu, so whatever opened it still sees one menu. Its top row, with its name,
  // goes back to the menu it was opened from, as ← does.
  /** @type {{ items: MenuItem[], label: string }[]} */
  const trail = [];
  let showing = { items, label: '' };
  const draw = () => {
    const back = trail.length ? { label: showing.label, go: () => ((showing = trail.pop()), draw()) } : null;
    node.replaceChildren(menuList(showing.items, showSubmenu, back));
    position(node, anchor, opts);
  };
  /** @type {(submenu: MenuItem[], from: MenuItem) => void} */
  const showSubmenu = (submenu, from) => {
    trail.push(showing);
    showing = { items: submenu, label: from.label ?? '' };
    draw();
  };
  const node = search
    ? openSearchMenu(anchor, items, search, showSubmenu, opts)
    : openPopover(anchor, menuList(items, showSubmenu), opts);
  return node;
}

/**
 * A menu under a box that narrows it down as you type. The caret stays in the box while the
 * arrows and Enter choose from the list, and once something is typed Enter takes the best match.
 * @param {Element | { x: number, y: number }} anchor
 * @param {MenuItem[]} items
 * @param {MenuSearch} search
 * @param {(submenu: MenuItem[], from: MenuItem) => void} showSubmenu
 * @param {{ align?: 'left' | 'right', above?: boolean, rect?: Rect, className?: string, onClose?: () => void }} opts
 */
function openSearchMenu(anchor, items, { label, find }, showSubmenu, { onClose, ...opts }) {
  const box = el(
    html`<div>
      <label class="menu-search">
        ${raw(smallIcon.search())}
        <input type="text" spellcheck="false" aria-label="${label}" placeholder="${label}" />
      </label>
    </div>`
  );
  const input = /** @type {HTMLInputElement} */ (box.querySelector('input'));
  let list = menuList(items, showSubmenu);
  box.appendChild(list);
  const draw = () => {
    const sought = input.value.trim();
    const shown = menuList(sought ? find(sought) : items, showSubmenu);
    if (sought) shown.querySelector('.menu-item:not(.disabled)')?.classList.add('active');
    list.replaceWith(shown);
    list = shown;
  };

  // The box takes the focus, and gives it back to where it was when the menu goes.
  const before = document.activeElement;
  const node = openPopover(anchor, box, {
    ...opts,
    onClose: () => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && before instanceof HTMLElement) before.focus();
      onClose?.();
    },
  });
  // As typing makes it narrower and shorter, it stays as wide as it opened, and against its
  // anchor on the side it opened on.
  box.style.minWidth = `${box.offsetWidth}px`;
  const anchorTop = (opts.rect ?? rectOf(anchor)).top;
  const above = opts.above || node.getBoundingClientRect().top < anchorTop;
  input.addEventListener('input', () => {
    draw();
    position(node, anchor, { ...opts, above });
  });
  // Clicking a row must not take the caret out of the box first.
  box.addEventListener('mousedown', (e) => {
    if (!(/** @type {Element} */ (e.target).closest('.menu-search'))) e.preventDefault();
  });
  input.focus();
  return node;
}

/**
 * A grid of pictures to pick from, with a caption for the one under the mouse.
 * @param {Element} anchor
 * @param {{ markup: string, caption: string, current?: boolean, pick: () => void }[]} items  `markup` is trusted
 * @param {{ className?: string, footer?: HTMLElement, onClose?: () => void }} [opts]
 */
export function openGrid(anchor, items, { className = '', footer, onClose } = {}) {
  const grid = el(`<div class="pick-grid ${className}"></div>`);
  const caption = el('<div class="popup-caption">&nbsp;</div>');
  for (const item of items) {
    const button = el(`<button type="button"${item.current ? ' class="current"' : ''}>${item.markup}</button>`);
    button.title = item.caption;
    button.addEventListener('mouseenter', () => {
      caption.textContent = item.caption;
    });
    button.addEventListener('click', () => {
      closeMenu();
      item.pick();
    });
    grid.appendChild(button);
  }
  const box = el('<div></div>');
  box.append(grid, caption, ...(footer ? [footer] : []));
  return openPopover(anchor, box, { onClose });
}

export const isMenuOpen = () => Boolean(current);
