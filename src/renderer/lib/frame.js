// The window chrome we draw ourselves: a Luna-blue title bar with minimize/maximize/close, and the
// window's menus (File, Edit, …). On a Mac they are in its own menu bar, at the top of the screen. Elsewhere
// the messenger has a classic menu bar under the title, and the professional look one ☰ in the title bar.
import { api } from './api.js';
import { $, el, escapeHtml } from './dom.js';
import { appIcon, windowGlyph } from './icons.js';
import { closeMenu, isMenuOpen, openMenu } from './menu.js';
import { nativeMenus } from '../../shared/native-menus.js';
import { windowTitle } from '../../shared/titles.js';

/** @typedef {import('./menu.js').MenuItem} MenuItem */

const IS_MAC = navigator.platform.toLowerCase().includes('mac');
// A Mac window is see-through outside the frame, which rounds its own top corners there (see frame.css).
document.documentElement.classList.toggle('own-corners', IS_MAC);
// The app's windows on a Mac put their menus in its menu bar. The browser preview's are pages of a page,
// served over http, with no menu bar of their own: they keep their menus in the window.
const NATIVE = IS_MAC && location.protocol === 'file:';
document.documentElement.classList.toggle('native-menus', NATIVE);

/** How long after something was done in a window its menus are looked at again for the menu bar. */
const SETTLE_MS = 150;
/** And how often while it is in front, for what changes by itself: an agent at work, a pull request's checks. */
const EVERY_MS = 1500;

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {{ label: string, items: () => MenuItem[] }[]} [opts.menus]
 * @param {boolean} [opts.maximizable]
 * @param {boolean} [opts.pinnable]  a pin before the window's buttons keeps it on top of other windows, as
 *   Always on top in its menus does
 * @param {boolean} [opts.settings]  a gear before the pin opens the Settings window, as Settings... in its
 *   menus does. Browser pages hide it (see styles/browser.css).
 * @returns {{
 *   setTitle: (value: string | import('../../shared/titles.js').WindowName) => void,
 *   menus: { label: string, items: () => MenuItem[] }[],
 *   setMenus: (menus: { label: string, items: () => MenuItem[] }[]) => void,
 * }}
 *   `menus`: the menu bar's, for what else lists what they do, as the palette (⌘K) does. `setMenus` puts
 *   others in their place, as for a window that learns what it shows once it is drawn: `menus` is then those
 */
export function mountFrame({ title, menus = [], maximizable = true, pinnable = false, settings = false }) {
  const win = $('.window');
  const titlebar = $('.titlebar', win);
  // The gear and the pin are not the window's own buttons: on a Mac those are the three round ones, at the left.
  const tools = [
    settings &&
      `<button class="titlebar-tool titlebar-settings" type="button" aria-label="Settings" title="Settings" tabindex="-1">${windowGlyph.settings()}</button>`,
    pinnable &&
      `<button class="titlebar-tool titlebar-pin" type="button" aria-label="Always on top" tabindex="-1">${windowGlyph.pin()}</button>`,
  ].filter(Boolean);
  titlebar.innerHTML = `
    ${menus.length ? `<button class="titlebar-menu" type="button" aria-label="Menu" title="Menu" aria-haspopup="menu" tabindex="-1">${windowGlyph.menu()}</button>` : ''}
    <span class="titlebar-icon">${appIcon(16)}</span>
    <span class="titlebar-text"></span>
    ${tools.length ? `<span class="titlebar-tools">${tools.join('')}</span>` : ''}
    <span class="titlebar-controls">
      <button class="wc wc-min" type="button" aria-label="Minimize" tabindex="-1">${windowGlyph.minimize()}</button>
      ${maximizable ? `<button class="wc wc-max" type="button" aria-label="Maximize" tabindex="-1">${windowGlyph.maximize()}</button>` : ''}
      <button class="wc wc-close" type="button" aria-label="Close" tabindex="-1">${windowGlyph.close()}</button>
    </span>`;
  const text = $('.titlebar-text', titlebar);
  /** @param {string | import('../../shared/titles.js').WindowName} value */
  const setTitle = (value) => {
    if (typeof value === 'string') {
      text.textContent = value;
      document.title = value;
      return;
    }
    text.replaceChildren(value.name, el(`<span class="titlebar-kind"> - ${escapeHtml(value.kind)}</span>`));
    document.title = windowTitle(value);
  };
  setTitle(title);

  $('.wc-min', titlebar).addEventListener('click', () => api.window.minimize());
  $('.wc-close', titlebar).addEventListener('click', () => api.window.close());
  if (maximizable) {
    $('.wc-max', titlebar).addEventListener('click', () => api.window.toggleMaximize());
    titlebar.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button')) api.window.toggleMaximize();
    });
  }
  const gear = $('.titlebar-settings', titlebar);
  // Settings opens over the window, and Back gives the focus to what had it: the message being typed, not the gear.
  gear?.addEventListener('mousedown', (e) => e.preventDefault());
  gear?.addEventListener('click', () => api.settings.open({}));
  const pin = $('.titlebar-pin', titlebar);
  pin?.addEventListener('click', () => api.window.setAlwaysOnTop(pin.getAttribute('aria-pressed') !== 'true'));
  showPinned(pin, false);

  api.on.windowState(({ focused, maximized, alwaysOnTop }) => {
    if (focused) toMenuBar();
    win.classList.toggle('inactive', !focused);
    win.classList.toggle('maximized', maximized);
    const max = $('.wc-max', titlebar);
    if (max) {
      max.innerHTML = maximized ? windowGlyph.restore() : windowGlyph.maximize();
      max.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
    }
    showPinned(pin, alwaysOnTop);
  });

  // One list, the same from start to end: what else reads it reads the menus as they are now.
  const shown = [...menus];
  const bar = $('.menubar', win);
  mountMenubar(bar, shown);
  // The ☰ has every menu in it, each a submenu.
  const burger = $('.titlebar-menu', titlebar);
  burger?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (burger.classList.contains('open')) return closeMenu();
    burger.classList.add('open');
    openMenu(
      burger,
      shown.map((menu) => ({ label: menu.label, submenu: menu.items() })),
      { onClose: () => burger.classList.remove('open') }
    );
  });
  const toMenuBar = NATIVE && shown.length ? nativeMenuBar(shown) : () => {};
  /** @param {{ label: string, items: () => MenuItem[] }[]} next */
  const setMenus = (next) => {
    if (isMenuOpen()) closeMenu();
    shown.splice(0, shown.length, ...next);
    bar?.replaceChildren();
    mountMenubar(bar, shown);
    toMenuBar();
  };
  return { setTitle, menus: shown, setMenus };
}

/**
 * Keeps the Mac's menu bar showing a window's menus as they would be if they opened now: they are sent as the
 * window comes to the front, shortly after anything is done in it, and every so often while it is in front,
 * when they changed. A row chosen there comes back by its id, and is done here.
 * @param {{ label: string, items: () => MenuItem[] }[]} menus
 * @returns {() => void}  sends them now, if they changed
 */
function nativeMenuBar(menus) {
  let sent = '';
  /** @type {Map<string, () => void>} */
  let actions = new Map();
  let soon = 0;
  const send = () => {
    clearTimeout(soon);
    let native;
    try {
      native = nativeMenus(menus);
    } catch {
      // What the menus say isn't known yet, as while the window is still asking for its contact.
      return;
    }
    actions = native.actions;
    const json = JSON.stringify(native.menus);
    if (json === sent) return;
    sent = json;
    api.window.menus(native.menus).catch(() => {});
  };
  const later = () => {
    clearTimeout(soon);
    soon = window.setTimeout(send, SETTLE_MS);
  };
  api.on.menuChosen((id) => {
    actions.get(id)?.();
    later();
  });
  for (const type of ['pointerup', 'keyup']) window.addEventListener(type, later, true);
  window.setInterval(() => document.hasFocus() && send(), EVERY_MS);
  send();
  return send;
}

/**
 * Says on the pin whether the window is kept on top, and what a click does.
 * @param {HTMLElement | null} pin
 * @param {boolean} onTop
 */
function showPinned(pin, onTop) {
  if (!pin) return;
  pin.setAttribute('aria-pressed', String(Boolean(onTop)));
  pin.title = onTop ? 'Kept on top of other windows. Click to stop' : 'Keep this window on top of other windows';
}

function mountMenubar(bar, menus) {
  if (!bar) return;
  let openIndex = -1;
  const buttons = menus.map((menu, i) => {
    const button = el(`<button class="menubar-item" type="button" tabindex="-1">${escapeHtml(menu.label)}</button>`);
    const open = () => {
      openIndex = i;
      buttons.forEach((b) => b.classList.toggle('open', b === button));
      openMenu(button, menu.items(), {
        onClose: () => {
          button.classList.remove('open');
          if (openIndex === i) openIndex = -1;
        },
      });
    };
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (openIndex === i) closeMenu();
      else open();
    });
    // Like a real menu bar: once a menu is open, hovering switches menus.
    button.addEventListener('mouseenter', () => {
      if (openIndex !== -1 && openIndex !== i && isMenuOpen()) open();
    });
    bar.appendChild(button);
    return button;
  });
}
