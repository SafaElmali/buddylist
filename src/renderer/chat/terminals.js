// The terminals beside the conversation: your own shell in the contact's
// folder, each in a tab of the side pane, as in a code editor. The shells are
// the main process's (src/main/terminals.js) and outlive this window: opened
// again, it shows them as they were left. The agent is not told any of it,
// unless you add one to a message: then it reads what the terminal shows.
import { FitAddon } from '../../../node_modules/@xterm/addon-fit/lib/addon-fit.mjs';
import { Terminal } from '../../../node_modules/@xterm/xterm/lib/xterm.mjs';
import {
  cleanTerminalName,
  COMFORTABLE_COLS,
  freeNumber,
  inOrder,
  isFindKey,
  paneRoomFor,
  SCROLLBACK_LINES,
  TERMINAL_PADDING,
  terminalTitle,
} from '../../shared/terminal.js';
import { matchesShortcut, shortcutKeys, systemOf } from '../../shared/shortcuts.js';
import { lastOutput, screenText } from '../../shared/terminal-mentions.js';
import { api } from '../lib/api.js';
import { el, errorText } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { currentLook, onLook } from '../lib/look.js';
import { openMenu } from '../lib/menu.js';
import { TerminalFind } from './terminal-find.js';

/** @typedef {import('../../main/terminals.js').TerminalEvent} TerminalEvent */

/**
 * A terminal as this window draws it.
 * @typedef {Object} Shell
 * @property {string} id
 * @property {number} number            which of the conversation's terminals it is: on its tab from the second on
 * @property {string | null} name       what the user called it instead, if anything
 * @property {Terminal} term
 * @property {FitAddon} fit
 * @property {TerminalFind} find        ⌘F there: finding in what it printed
 * @property {HTMLElement} body         its tab's contents
 * @property {ResizeObserver} watcher   draws it again at the size its tab gets
 * @property {boolean} inPage           whether it had a size when last looked at: not while put away, or behind another tab
 * @property {number | null} startedAt  when this window started it; null for one that was running already
 */

const SYSTEM = systemOf(navigator.platform);
const FONT_SIZE = 12;

// The ink is the window's own at night, as theme.css names it: the blue's, or a palette's (see
// palettes.css). With the orange of the chosen tab for a cursor, and the sixteen colours programs
// print in, picked to be read on it.
const THEME = {
  cursor: '#f8b330',
  selectionForeground: '#ffffff',
  scrollbarSliderBackground: 'rgba(156, 196, 255, 0.22)',
  scrollbarSliderHoverBackground: 'rgba(156, 196, 255, 0.38)',
  scrollbarSliderActiveBackground: 'rgba(156, 196, 255, 0.5)',
  red: '#ff6b5e',
  green: '#7ddc6f',
  yellow: '#f5c451',
  blue: '#6ba6ff',
  magenta: '#c79bf2',
  cyan: '#5fd4e0',
  brightRed: '#ff8f85',
  brightGreen: '#a3ec97',
  brightYellow: '#ffd97a',
  brightBlue: '#9cc4ff',
  brightMagenta: '#dbb9ff',
  brightCyan: '#8fe6ee',
  brightWhite: '#ffffff',
};

// The professional look's ink, with its text for a cursor.
const PRO_THEME = {
  ...THEME,
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.16)',
  scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.28)',
  scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.38)',
};

/** The colours of a terminal in the window's look, and in the colours its stylesheets have now. @param {import('../lib/look.js').Look} look */
function terminalTheme(look) {
  const style = getComputedStyle(document.documentElement);
  const colour = (name) => style.getPropertyValue(`--terminal-${name}`).trim();
  const ink = {
    background: colour('bg'),
    foreground: colour('text'),
    cursorAccent: colour('bg'),
    selectionBackground: colour('select'),
    black: colour('black'),
    white: colour('text'),
    brightBlack: colour('dim'),
  };
  return look === 'professional' ? { ...PRO_THEME, ...ink, cursor: ink.foreground } : { ...THEME, ...ink };
}

// A shell that ends this soon after it started never got as far as a prompt.
const SOON_MS = 1500;
// A tab has its size once it kept one for this long: the window is done making room for the pane.
const QUIET_MS = 80;
// It is not waited for longer than this: a tab that isn't showing never gets a size.
const SETTLE_MS = 1000;

const fontFamily = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace';

/** How wide one letter of a terminal is drawn, measured the way the terminal does it. */
function letterWidth() {
  const pen = new OffscreenCanvas(1, 1).getContext('2d');
  pen.font = `${FONT_SIZE}px ${fontFamily()}`;
  return pen.measureText('W').width;
}

/**
 * Has a terminal measure its letters again. xterm does that when the screen's scale changes,
 * as it does for a window that moves to another display, and a terminal that is not in the
 * page at that moment (put away, or behind another tab) measures nothing: from then on it
 * draws every letter a whole cell apart. It has no call to measure again, but it does so
 * whenever one of its options changes. So one that changes nothing is changed and put back.
 * @param {Terminal} term
 */
function measureAgain(term) {
  // One that was never drawn has nothing to put right.
  if (!term.element) return;
  const { scrollSensitivity } = term.options;
  term.options.scrollSensitivity = scrollSensitivity + 1;
  term.options.scrollSensitivity = scrollSensitivity;
  term.refresh(0, term.rows - 1);
}

/**
 * Gives a terminal the colours of a look, and the room around it the same background.
 * @param {Shell} shell
 * @param {import('../lib/look.js').Look} look
 */
function paint(shell, look) {
  const theme = terminalTheme(look);
  shell.term.options.theme = theme;
  shell.body.style.background = theme.background;
}

/** Resolves once `node` has a size and has kept it for a moment, or after `SETTLE_MS` at the latest. */
function settled(node) {
  return new Promise((resolve) => {
    let quiet;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(latest);
      watcher.disconnect();
      resolve();
    };
    const latest = setTimeout(done, SETTLE_MS);
    const watcher = new ResizeObserver(() => {
      clearTimeout(quiet);
      if (node.clientWidth && node.clientHeight) quiet = setTimeout(done, QUIET_MS);
    });
    watcher.observe(node);
  });
}

/**
 * A terminal as a message can hand it to the agent: what it shows is read as the message goes.
 * @param {Shell} shell
 * @returns {import('../../shared/terminal-mentions.js').OutputCard}
 */
const card = (shell) => ({ kind: 'terminal', id: shell.id, name: terminalTitle(shell.number, shell.name) });

export class Terminals {
  /** @type {Map<string, Shell>} the terminals of this conversation, the oldest first */
  #shells = new Map();
  /** @type {string | null} the terminal used last: the one to go back to */
  #last = null;
  /**
   * Between asking for a new terminal and its shell being there: a second press does nothing.
   * @type {Promise<void> | null}  over when that shell is there, or could not be started
   */
  #opening = null;
  /** @type {number | undefined} how wide the pane has to be for a terminal, once that was measured */
  #room;

  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ contactId: string, settings: object }} ctx  `settings`: the app's, for the keys that are the window's
   * @param {object} opts
   * @param {(text: string) => void} opts.error  says in the conversation what went wrong
   * @param {() => void} opts.leave  puts the keyboard back where it was before: the message box
   * @param {(card: import('../../shared/terminal-mentions.js').OutputCard, how: 'menu' | 'selection') => void} [opts.mention]
   *   puts a terminal's output in the message box, or what is selected in it
   */
  constructor(pane, ctx, { error, leave, mention = () => {} }) {
    this.pane = pane;
    this.ctx = ctx;
    this.error = error;
    this.leave = leave;
    this.mention = mention;
    // The shells that are open go over to another look or palette with the window.
    onLook((look) => {
      for (const shell of this.#shells.values()) paint(shell, look);
    });
  }

  get size() {
    return this.#shells.size;
  }

  /** Whether a terminal is in the side pane right now. Put away, its shell runs on. */
  get showing() {
    return [...this.#shells.keys()].some((id) => this.pane.has(id));
  }

  /**
   * Whether `node` is in a terminal, its Find box too. What is typed there is the shell's, or the
   * box's: Esc is for vim, or puts the box away, and nudges nobody.
   */
  owns(node) {
    return Boolean(/** @type {Element | null} */ (node)?.closest?.('.terminal-tab'));
  }

  /**
   * Call once the window has drawn its conversation. The shells that are already running
   * for the contact are shown again, as their screens are, and everything from here on
   * is followed.
   */
  async attach() {
    api.on.terminal((event) => this.#onEvent(event));
    for (const { id, number, name, ...screen } of await api.terminal.list(this.ctx.contactId)) {
      // One that was opened in the meantime is here already.
      if (!this.#shells.has(id)) this.#draw(id, number, name, screen);
    }
  }

  /**
   * The contact was archived: its backend ends the shells, and the pane loses their input at once.
   * Also forgets tabs still waiting for their size, before they have asked the backend to start a shell.
   */
  clear() {
    for (const shell of this.#shells.values()) this.#forget(shell);
  }

  /** @param {TerminalEvent} event */
  #onEvent(event) {
    // The agent asked for terminals: they are opened as the user's own are.
    if (event.type === 'open') return void this.#openSeveral(event.names, event.command);
    const shell = this.#shells.get(event.id);
    if (!shell) return;
    if (event.type === 'output') return shell.term.write(event.data);
    if (event.type !== 'ended') return;
    this.#forget(shell);
    // Why is in what it printed, and that went with its tab.
    if (event.code && shell.startedAt && Date.now() - shell.startedAt < SOON_MS) {
      this.error(`The shell ended as soon as it started, with exit code ${event.code}.`);
    }
  }

  // ---- handing what one shows to the agent -------------------------------------------------------

  /**
   * The terminals of this conversation, in the order of their tabs, as a message can hand one to the agent.
   * @returns {import('../../shared/terminal-mentions.js').OutputCard[]}
   */
  list() {
    return [...this.#shells.values()].map(card);
  }

  /**
   * What a terminal shows now, its lines above the screen too, as text: as you see it. Null for one that is
   * gone, or another contact's.
   * @param {string} id
   * @returns {{ name: string, text: string } | null}
   */
  output(id) {
    const shell = this.#shells.get(id);
    return shell ? { name: terminalTitle(shell.number, shell.name), text: screenText(shell.term.buffer.active) } : null;
  }

  /** What its menus offer, to add it to the message: what is selected in it, or all it shows. @param {Shell} shell */
  #mentionItems(shell) {
    const selected = shell.term.getSelection();
    return [
      ...(selected.trim()
        ? [
            {
              label: 'Add selection to message',
              action: () => this.mention({ ...card(shell), ...lastOutput(selected), selection: true }, 'selection'),
            },
          ]
        : []),
      { label: 'Add to message', action: () => this.mention(card(shell), 'menu') },
    ];
  }

  // ---- opening, showing and putting away ---------------------------------------------------------

  /** How the pane's + lists this kind of tab: choosing it opens another terminal. Its shortcut is the window's to add. */
  get kind() {
    return { label: 'Terminal', icon: smallIcon.terminal(), open: () => this.open() };
  }

  /**
   * Starts another shell in the contact's folder, in a tab of its own.
   * @param {object} [opts]
   * @param {string | null} [opts.name]  what its tab says, for one that was asked for by name
   * @param {boolean} [opts.focus]  whether the keyboard goes there. Not for one the agent asked for:
   *   the user is in the middle of saying something
   * @param {string | null} [opts.command]  what it is opened to run: typed in once its shell is up
   * @param {boolean} [opts.unasked]  nobody asked for it: the one a new worktree starts with. It is not
   *   counted as opened
   */
  open({ name = null, focus = true, command = null, unasked = false } = {}) {
    this.#opening ??= this.#start(name, focus, command, unasked).finally(() => {
      this.#opening = null;
    });
    return this.#opening;
  }

  async #start(name, focus, command, unasked) {
    // Every terminal is back in the pane first: the new one is one more of them.
    this.#restore();
    const number = freeNumber([...this.#shells.values()].map((s) => s.number));
    const shell = this.#draw(crypto.randomUUID(), number, name);
    try {
      // The shell starts at the size its tab has once the window has made room for the pane:
      // a prompt drawn for another width leaves its wrapped half behind.
      await settled(shell.body);
      // Closed again before it got that far.
      if (!this.#shells.has(shell.id)) return;
      this.#fit(shell);
      const { cols, rows } = shell.term;
      await api.terminal.open(this.ctx.contactId, { id: shell.id, number, name, command, cols, rows }, { unasked });
      if (!this.#shells.has(shell.id)) return;
      shell.startedAt = Date.now();
      if (focus && this.pane.shows(shell.id)) shell.term.focus();
    } catch (err) {
      // Archiving already removed its tab: cancellation is expected, and the terminal is disposed.
      if (!this.#shells.has(shell.id)) return;
      this.#forget(shell);
      this.error(errorText(err));
    }
  }

  /**
   * Starts several, one after another: each is numbered after the one before, and drawn
   * at the size the pane has by then.
   * @param {(string | null)[]} names  what each tab says, or null for its number
   * @param {string | null} [command]  what each is opened to run
   */
  async #openSeveral(names, command = null) {
    for (const name of names) {
      // One the user asked for at the same moment goes first, and is not counted as one of these.
      while (this.#opening) await this.#opening;
      await this.open({ name, command, focus: false });
    }
  }

  /** The Terminal button: shows the terminals, starting one when there is none, or puts them away. */
  toggle() {
    if (this.showing) this.hide();
    else this.#reveal();
  }

  /**
   * ⌘J, as in a code editor: to the terminal and, pressed there, back to the message
   * box with the terminals put away.
   */
  key() {
    if (this.owns(document.activeElement)) this.hide();
    else this.#reveal();
  }

  /**
   * ⌘F in a terminal: a box over it to find in what it printed. Each terminal has its own.
   * @param {Node} node  where it was pressed
   */
  find(node) {
    const shell = [...this.#shells.values()].find((s) => s.body.contains(node));
    shell?.find.open();
  }

  /**
   * Puts the terminals away, with the rest of the pane's lower half: the project's scripts are
   * always there with them. Their shells run on, and come back as they were.
   */
  hide() {
    this.pane.closeLower();
    this.leave();
  }

  /**
   * The user dragged a tab to another place. The terminals keep that order, here and for
   * the window that opens later.
   * @param {string[]} ids  the tabs of the side pane as they are now, a plan's among them
   */
  reordered(ids) {
    this.#shells = new Map(inOrder([...this.#shells.values()], ids).map((shell) => [shell.id, shell]));
    api.terminal.reorder(this.ctx.contactId, [...this.#shells.keys()]);
  }

  /** Puts every terminal that was put away back into the pane. */
  #restore() {
    for (const shell of this.#shells.values()) {
      if (!this.pane.has(shell.id)) this.pane.open(this.#tab(shell));
    }
  }

  /** Brings the terminals back and goes to the one used last. Without any, starts one. */
  #reveal() {
    if (!this.#shells.size) return this.open();
    this.#restore();
    const shell = this.#shells.get(this.#last) ?? [...this.#shells.values()].at(-1);
    this.pane.select(shell.id);
    shell.term.focus();
  }

  // ---- one terminal ------------------------------------------------------------------------------

  /** @param {Shell} shell @returns {import('./side-pane.js').PaneTab} */
  #tab(shell) {
    // Measured once: the letters of every terminal here are the same size.
    this.#room ??= paneRoomFor(COMFORTABLE_COLS, letterWidth());
    return {
      id: shell.id,
      title: terminalTitle(shell.number, shell.name),
      icon: smallIcon.terminal(),
      body: shell.body,
      // With what else runs in the folder: the project's scripts.
      lower: true,
      room: this.#room,
      // What a right-click on its tab offers first: its output, to go with the message.
      menu: () => this.#mentionItems(shell),
      // A name of the user's own, kept with the shell. Emptied, the tab says again which terminal it is.
      rename: (typed) => {
        shell.name = cleanTerminalName(typed) || null;
        api.terminal.rename(shell.id, shell.name ?? '');
        return terminalTitle(shell.number, shell.name);
      },
      // Closing its tab is closing the terminal: the shell ends, with what runs in it.
      onClose: () => {
        api.terminal.close(shell.id);
        this.#forget(shell);
      },
    };
  }

  /**
   * A terminal in a tab of its own, wired to the shell called `id`: what is typed goes
   * there, also while the shell is still being started, and is dropped until it is.
   * @param {string} id
   * @param {number} number
   * @param {string | null} [name]
   * @param {{ output: string, cols: number, rows: number } | null} [screen]  what is on its screen,
   *   for a shell that was running already, and the size that was drawn at
   * @returns {Shell}
   */
  #draw(id, number, name = null, screen = null) {
    const term = new Terminal({
      ...(screen && { cols: screen.cols, rows: screen.rows }),
      fontFamily: fontFamily(),
      fontSize: FONT_SIZE,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: SCROLLBACK_LINES,
      theme: terminalTheme(currentLook()),
      // What Find marks its matches with is one of xterm's proposed parts.
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Not the shell's keys: the window's own, to go back to the message box, open another terminal
    // or find in this one.
    term.attachCustomKeyEventHandler((e) => {
      const keys = shortcutKeys(this.ctx.settings, SYSTEM);
      return (
        !matchesShortcut(e, keys.terminal) &&
        !matchesShortcut(e, keys.newTerminal) &&
        !isFindKey(e, SYSTEM === 'mac', true)
      );
    });
    term.onData((data) => api.terminal.write(id, data));
    term.onResize(({ cols, rows }) => api.terminal.resize(id, cols, rows));

    const body = el('<div class="terminal-tab"></div>');
    /** @type {Shell} */
    const shell = {
      id,
      number,
      name,
      term,
      fit,
      find: new TerminalFind(term, body),
      body,
      watcher: new ResizeObserver(() => this.#sized(shell)),
      inPage: false,
      startedAt: null,
    };
    paint(shell, currentLook());
    shell.body.addEventListener('focusin', () => {
      this.#last = id;
    });
    // A right-click in it offers to add what it shows to the message, or what is selected in it.
    shell.body.addEventListener('contextmenu', (e) => {
      // Not in its Find box.
      if (!shell.term.element?.contains(/** @type {Node} */ (e.target))) return;
      e.preventDefault();
      openMenu({ x: e.clientX, y: e.clientY }, this.#mentionItems(shell));
    });
    this.#shells.set(id, shell);
    // In the page first: a terminal measures its letters where it is drawn.
    this.pane.open(this.#tab(shell));
    term.open(shell.body);
    // The room around the letters is the terminal's own: it is left out when its rows and columns are counted.
    const { top, right, bottom, left } = TERMINAL_PADDING;
    term.element.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
    if (!screen) {
      shell.watcher.observe(shell.body);
      return shell;
    }
    // A screen is drawn again at the size it has, and only then made the size of its tab: a
    // terminal draws a moment later, and at another size it would come out as rubbish.
    term.write(screen.output, () => {
      if (this.#shells.has(id)) shell.watcher.observe(shell.body);
    });
    return shell;
  }

  /** A terminal's tab has another size, or has one again after being put away or behind another tab. */
  #sized(shell) {
    const inPage = Boolean(shell.body.clientWidth && shell.body.clientHeight);
    // What it measured while it was not in the page may be nothing.
    if (inPage && !shell.inPage) measureAgain(shell.term);
    shell.inPage = inPage;
    this.#fit(shell);
  }

  /** Draws a terminal as big as its tab is, and its shell hears of it. One that isn't showing has no size to go by. */
  #fit(shell) {
    if (shell.body.clientWidth && shell.body.clientHeight) shell.fit.fit();
  }

  /** A terminal is over: its tab goes, and the keyboard with it if it was there. */
  #forget(shell) {
    const typing = shell.body.contains(document.activeElement);
    this.#shells.delete(shell.id);
    if (this.#last === shell.id) this.#last = null;
    shell.watcher.disconnect();
    this.pane.close(shell.id, { unavailable: true });
    shell.term.dispose();
    if (typing) this.leave();
  }
}
