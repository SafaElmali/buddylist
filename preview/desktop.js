// A small window manager for the web preview: each app window is an iframe
// on a desktop, with dragging, focus, minimize/maximize, a nudge shake and
// an XP-style taskbar.
import { widened } from '../src/shared/side-pane.js';
import { DEFAULT_LOOK, FIRST_THEME, paletteOf, schemeOf } from '../src/shared/theme.js';

const desktop = document.getElementById('cm-desktop');
const taskbar = document.getElementById('cm-tasks');

// The colour scheme of a window's frame. A page in another scheme than its frame is given a
// solid background by the browser, and a toast is see-through around its card.
const frameScheme = (theme) => (schemeOf(theme) === 'system' ? 'light dark' : schemeOf(theme));

let zTop = 10;
let counter = 0;

export class Desktop {
  #look;

  /** @param {(win: any) => void} onClosed */
  constructor(onClosed) {
    this.windows = [];
    this.onClosed = onClosed;
    this.focused = null;
    /** How the windows look: one of THEMES. In the app, Electron shows them in its colour scheme. */
    this.theme = FIRST_THEME;
    /** What the windows still to open are drawn as. The open ones follow the settings they are sent. */
    this.look = DEFAULT_LOOK;
  }

  /** The look the windows are drawn in, which the desktop itself follows (preview/page.html). */
  get look() {
    return this.#look;
  }

  set look(look) {
    this.#look = look;
    document.documentElement.dataset.look = look;
  }

  /** Has every window, and the ones still to open, look that way: see preview/bridge.js. */
  showIn(theme) {
    this.theme = theme;
    for (const win of this.windows) {
      win.iframe.style.colorScheme = frameScheme(theme);
      win.iframe.contentWindow?.postMessage({ __cm: true, kind: 'scheme', scheme: schemeOf(theme) }, '*');
    }
  }

  /**
   * @param {'contacts' | 'chat' | 'history' | 'toast'} kind
   * @param {{ key?: string, search?: string, title: string, rect: { x: number, y: number, w: number, h: number }, taskbar?: boolean }} opts
   */
  open(kind, { key = kind, search = '', title, rect, taskbar: onTaskbar = true }) {
    const frame = document.createElement('div');
    frame.className = `cm-win cm-${kind}`;
    const iframe = document.createElement('iframe');
    iframe.title = title;
    iframe.setAttribute('allow', 'autoplay');
    // Each window is its own page; its parameters travel in the #hash, and with them how it
    // is to look, so that it is drawn that way from the start.
    const params = new URLSearchParams(search);
    params.set('scheme', schemeOf(this.theme));
    params.set('look', this.look);
    params.set('palette', paletteOf(this.theme));
    iframe.style.colorScheme = frameScheme(this.theme);
    iframe.src = `${kind}.html#${params}`;
    iframe.addEventListener('load', () => frame.classList.add('cm-loaded'), { once: true });
    frame.appendChild(iframe);
    desktop.appendChild(frame);
    const win = {
      id: ++counter,
      kind,
      key,
      title,
      frame,
      iframe,
      rect: { ...rect },
      minimized: false,
      maximized: false,
      onTaskbar,
    };
    this.windows.push(win);
    this.#place(win);
    if (kind !== 'toast') this.focus(win);
    else frame.style.zIndex = '100000';
    this.renderTaskbar();
    return win;
  }

  find(kind, key = kind) {
    return this.windows.find((w) => w.kind === kind && w.key === key) || null;
  }

  fromSource(source) {
    return this.windows.find((w) => w.iframe.contentWindow === source) || null;
  }

  send(win, channel, payload) {
    win?.iframe.contentWindow?.postMessage({ __cm: true, kind: 'event', channel, payload }, '*');
  }

  broadcast(channel, payload) {
    for (const win of this.windows) this.send(win, channel, payload);
  }

  #place(win) {
    const { frame, rect } = win;
    frame.classList.toggle('maximized', win.maximized);
    frame.hidden = win.minimized;
    if (win.kind === 'toast') {
      Object.assign(frame.style, {
        right: `${rect.x}px`,
        bottom: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`,
      });
      return;
    }
    Object.assign(frame.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.w}px`,
      height: `${rect.h}px`,
    });
  }

  #sendState(win) {
    this.send(win, 'window:state', {
      focused: this.focused === win,
      maximized: win.maximized,
      alwaysOnTop: Boolean(win.alwaysOnTop),
    });
  }

  focus(win) {
    if (!win || win.kind === 'toast') return;
    const previous = this.focused;
    this.focused = win;
    win.minimized = false;
    win.frame.style.zIndex = String(win.alwaysOnTop ? 50000 : ++zTop);
    this.#place(win);
    if (previous && previous !== win) this.#sendState(previous);
    this.#sendState(win);
    this.renderTaskbar();
  }

  isFocused(win) {
    return Boolean(win) && this.focused === win && document.hasFocus();
  }

  minimize(win) {
    win.minimized = true;
    if (this.focused === win) this.focused = null;
    this.#place(win);
    this.#sendState(win);
    this.renderTaskbar();
  }

  toggleMaximize(win) {
    win.maximized = !win.maximized;
    this.#place(win);
    this.#sendState(win);
  }

  setAlwaysOnTop(win, on) {
    win.alwaysOnTop = on;
    win.frame.style.zIndex = String(on ? 50000 : ++zTop);
    this.#sendState(win);
  }

  /**
   * Title-bar dragging. The frame reports pointer positions in its own
   * coordinates; adding the window's position gives a stable desktop point.
   */
  drag(win, phase, x, y) {
    const point = { x: win.rect.x + x, y: win.rect.y + y };
    if (phase === 'move' && win.dragFrom) this.moveBy(win, point.x - win.dragFrom.x, point.y - win.dragFrom.y);
    win.dragFrom = point;
  }

  moveBy(win, dx, dy) {
    if (win.maximized) return;
    const bounds = desktop.getBoundingClientRect();
    win.rect.x = Math.min(Math.max(win.rect.x + dx, -win.rect.w + 80), bounds.width - 80);
    win.rect.y = Math.min(Math.max(win.rect.y + dy, 0), bounds.height - 30);
    this.#place(win);
  }

  close(win) {
    if (!win) return;
    // The contact list hides instead of closing, like the real app on a Mac.
    if (win.kind === 'contacts') return this.minimize(win);
    win.frame.remove();
    this.windows = this.windows.filter((w) => w !== win);
    if (this.focused === win) this.focused = null;
    this.renderTaskbar();
    this.onClosed(win);
  }

  /**
   * As the app does: a window grows to make room for its side pane, and gives the room back
   * when that closes. The list of your contacts takes its room from the conversation instead.
   * @param {any} win
   * @param {number} width
   */
  makeRoom(win, width) {
    if (!win) return;
    const { rect } = win;
    const had = win.room;
    Object.assign(rect, { x: rect.x + (had?.moved || 0), w: rect.w - (had?.grown || 0) });
    win.room = null;
    if (width > 0) {
      const area = { x: 0, width: desktop.getBoundingClientRect().width };
      const after = widened({ x: rect.x, width: rect.w }, area, Math.round(width));
      win.room = { grown: after.width - rect.w, moved: rect.x - after.x };
      Object.assign(rect, { x: after.x, w: after.width });
    }
    this.#place(win);
  }

  /**
   * Loads a window's page again, for something else: a conversation window that goes on to
   * another contact. It starts over, so its side pane is closed and its room given back.
   * @param {any} win
   * @param {{ key: string, search: string, title: string }} to
   */
  navigate(win, { key, search, title }) {
    this.makeRoom(win, 0);
    win.key = key;
    // Only the #hash differs, which a page takes without loading again: so it is told to.
    win.iframe.src = `${win.kind}.html#${search.replace(/^\?/, '')}`;
    win.iframe.contentWindow?.location.reload();
    this.retitle(win, title);
  }

  shake(win) {
    if (!win || win.maximized) return;
    win.frame.classList.remove('cm-shaking');
    void win.frame.offsetWidth;
    win.frame.classList.add('cm-shaking');
  }

  renderTaskbar() {
    taskbar.replaceChildren(
      ...this.windows
        .filter((w) => w.onTaskbar)
        .map((w) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `cm-task${this.focused === w && !w.minimized ? ' active' : ''}`;
          button.textContent = w.title;
          button.title = w.title;
          button.addEventListener('click', () => {
            if (this.focused === w && !w.minimized) this.minimize(w);
            else this.focus(w);
          });
          return button;
        })
    );
  }

  retitle(win, title) {
    win.title = title;
    win.iframe.title = title;
    this.renderTaskbar();
  }
}
