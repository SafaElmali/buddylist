// The terminals beside a conversation: the user's own shell in the contact's
// folder, on a pseudo-terminal, as in a code editor. A shell belongs to its
// contact and not to the window: closed and opened again, the window shows it
// as it was left. An agent can ask for terminals to be opened (app-tools.js), and
// is never told what happens in one.
//
// What a window that opens later is shown is the screen as it is, drawn here by a
// terminal of its own, and not what the shell printed. That can't be drawn again:
// what a shell draws is for the size it has at the time, and zsh, say, draws its
// prompt again each time that changes. At another size it leaves rubbish behind.
import serialize from '@xterm/addon-serialize';
import headless from '@xterm/headless';
import fs from 'node:fs';
import { cleanCommand } from '../shared/app-tools.js';
import { cleanNumber, cleanSize, cleanTerminalName, inOrder, SCROLLBACK_LINES } from '../shared/terminal.js';
import { shortPath } from './conversations.js';

// Both are written for require(): they hand ES modules everything in one.
const { Terminal: Screen } = headless;
const { SerializeAddon } = serialize;

/**
 * A terminal as a conversation window is told about it.
 * @typedef {Object} TerminalView
 * @property {string} id
 * @property {number} number  which of the conversation's terminals it is: its tab says so from the second on
 * @property {string | null} name  what the user called it instead, if anything
 * @property {string} output  its screen and the lines above it, as they are now: what draws them again
 * @property {number} cols  the size they were drawn at, the shell's own
 * @property {number} rows
 */

/**
 * What the window of a terminal's contact is sent as things happen.
 * @typedef {(
 *   { type: 'output', id: string, data: string } |
 *   { type: 'ended', id: string, code: number | null, signal: number | null } |
 *   { type: 'open', names: (string | null)[], command: string | null }
 * )} TerminalEvent  `open` asks the window for more terminals, one for each name: it starts them as it
 *   starts the ones the user asks for, so each has its tab, its number and its size from there.
 *   `command` is typed into each of them once its shell is up
 */

/**
 * The part of node-pty this needs.
 * @typedef {Object} Pty
 * @property {(listener: (data: string) => void) => unknown} onData
 * @property {(listener: (exit: { exitCode: number, signal?: number }) => void) => unknown} onExit
 * @property {(data: string) => void} write
 * @property {(cols: number, rows: number) => void} resize
 * @property {(signal?: string) => void} kill
 */

/** @typedef {(file: string, args: string[], options: object) => Pty} SpawnPty */

// What a shell prints reaches its window this often at most: a key pressed is echoed
// without a wait anyone notices, and a flood of output arrives in pieces a window can draw.
const SEND_EVERY_MS = 8;

// A command a terminal was opened to run is typed in once its shell has stopped printing for
// this long: by then its prompt is there, and the command is shown once, where the user would type it.
const PROMPT_QUIET_MS = 200;
// A shell that prints nothing gets it after this long all the same.
const PROMPT_LATEST_MS = 3000;

/**
 * node-pty, loaded when the first terminal opens: it is built for the computer it runs
 * on, and where that didn't work the rest of the app is not kept from starting.
 * @returns {Promise<SpawnPty>}
 */
async function loadPty() {
  try {
    const pty = await import('node-pty');
    return (pty.default ?? pty).spawn;
  } catch (err) {
    throw new Error(`Terminals can’t be used here: node-pty could not be loaded (${err.message}).`, {
      cause: err,
    });
  }
}

/**
 * The user's own shell, started as their terminal app starts it.
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 */
export function shellFor(env, platform) {
  if (platform === 'win32') return { file: env.COMSPEC || 'cmd.exe', args: [] };
  // On a Mac a terminal's shell is a login shell: that is where its PATH is put together.
  return { file: env.SHELL || '/bin/sh', args: platform === 'darwin' ? ['-l'] : [] };
}

/** @returns {TerminalView} */
const view = ({ id, number, name, screen, serializer, drawing }) => ({
  id,
  number,
  name,
  // What it printed last may not be on its screen yet: it comes after, as it would have.
  output: serializer.serialize() + drawing.join(''),
  cols: screen.cols,
  rows: screen.rows,
});

export class Terminals {
  /** id -> a shell that is running, the oldest first */
  #terminals = new Map();
  /** id -> an individual start request waiting for node-pty or its project's environment */
  #starting = new Map();
  /** @type {SpawnPty | undefined} */
  #spawn;

  /**
   * @param {object} deps
   * @param {import('./storage/store.js').Store} deps.store  where a contact's folder is looked up
   * @param {(contactId: string, event: TerminalEvent) => boolean} deps.send  tells the contact's
   *   conversation window; false when it has none open
   * @param {SpawnPty} [deps.spawn]  starts a program on a pseudo-terminal; node-pty's own
   * @param {Record<string, string | undefined>} [deps.env]  what every shell inherits: the login shell's PATH is in it
   * @param {(cwd: string) => Record<string, string> | Promise<Record<string, string>>} [deps.environment]  the
   *   variables the project of a folder adds to that (see Projects.environmentIn)
   * @param {string} [deps.platform]
   */
  constructor({ store, send, spawn, env = process.env, environment = () => ({}), platform = process.platform }) {
    this.store = store;
    this.send = send;
    this.env = env;
    this.environment = environment;
    this.platform = platform;
    this.#spawn = spawn;
  }

  /**
   * Tells the contact's conversation window. One that is just going away can't be told
   * any more than one that is closed, and a shell must not trip over that.
   */
  #tell(contactId, event) {
    try {
      return Boolean(this.send(contactId, event));
    } catch {
      return false;
    }
  }

  /**
   * Starts a shell in the contact's folder. Throws a message for the user when it can't.
   * @param {string} contactId
   * @param {object} opts
   * @param {string} opts.id  the window's own name for it: its tab is there before the shell is
   * @param {number} [opts.number]  the number on that tab, kept for the window that opens later
   * @param {string | null} [opts.name]  what its tab says instead, when it was asked for by name
   * @param {string | null} [opts.command]  what it was opened to run: typed in once its shell is up
   * @param {number} [opts.cols]  how big the window drew it
   * @param {number} [opts.rows]
   * @returns {Promise<TerminalView>}
   */
  async open(contactId, { id, number, name, command, ...size } = /** @type {any} */ ({})) {
    const contact = this.store.getContact(contactId);
    if (!contact) throw new Error('This contact no longer exists.');
    if (contact.archived) throw new Error('Restore this contact before opening a terminal.');
    if (typeof id !== 'string' || !id || this.#terminals.has(id) || this.#starting.has(id))
      throw new Error('That terminal is open already.');
    if (!fs.existsSync(contact.cwd)) throw new Error(`The folder ${shortPath(contact.cwd)} isn’t there any more.`);
    const starting = { contactId };
    this.#starting.set(id, starting);
    let environment;
    try {
      this.#spawn ??= await loadPty();
      this.#checkStarting(id, starting);
      environment = await this.environment(contact.cwd);
      this.#checkStarting(id, starting);
    } finally {
      // A cancelled id may already belong to a new request. Only this request can finish itself.
      if (this.#starting.get(id) === starting) this.#starting.delete(id);
    }

    const { file, args } = shellFor(this.env, this.platform);
    const { cols, rows } = cleanSize(size);
    let pty;
    try {
      pty = this.#spawn(file, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: contact.cwd,
        // What the window can draw: 256 colours and more, as the programs in it ask.
        env: { ...this.env, ...environment, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'buddylist' },
      });
    } catch (err) {
      throw new Error(`The shell ${file} could not be started: ${err.message}.`, { cause: err });
    }

    // Its screen, at the shell's size. What draws it again is one of xterm's proposed parts.
    const screen = new Screen({ cols, rows, scrollback: SCROLLBACK_LINES, allowProposedApi: true });
    const serializer = new SerializeAddon();
    screen.loadAddon(serializer);
    const terminal = {
      id,
      number: cleanNumber(number),
      /** @type {string | null} */
      name: cleanTerminalName(name) || null,
      contactId,
      pty,
      screen,
      serializer,
      /** @type {string[]} printed, and not on its screen yet: a terminal draws a moment later */
      drawing: [],
      /** Printed, and not sent to the window yet. */
      unsent: '',
      timer: null,
      /** @type {string | null} what it was opened to run, until that is typed in */
      toType: cleanCommand(command) || null,
      typing: null,
    };
    this.#terminals.set(id, terminal);
    pty.onData((data) => this.#printed(terminal, data));
    pty.onExit(({ exitCode, signal }) => this.#exited(terminal, exitCode, signal));
    if (terminal.toType) terminal.typing = setTimeout(() => this.#typeCommand(terminal), PROMPT_LATEST_MS);
    return view(terminal);
  }

  /** A close cancels this request permanently, even if the contact is restored during the wait. */
  #checkStarting(id, starting) {
    if (this.#starting.get(id) !== starting) throw new Error('This terminal was closed before its shell started.');
    const contact = this.store.getContact(starting.contactId);
    if (!contact) throw new Error('This contact no longer exists.');
    if (contact.archived) throw new Error('Restore this contact before opening a terminal.');
  }

  /** Types in what a terminal was opened to run, and runs it, as the user would: once. */
  #typeCommand(terminal) {
    clearTimeout(terminal.typing);
    const command = terminal.toType;
    terminal.toType = null;
    if (!command || !this.#terminals.has(terminal.id)) return;
    try {
      terminal.pty.write(`${command}\r`);
    } catch {
      // The shell ended before it got to it.
    }
  }

  /**
   * Asks the contact's conversation window to open more terminals, as its own + does.
   * @param {string} contactId
   * @param {(string | null)[]} names  one for each terminal: what its tab says, or null for its number
   * @param {string | null} [command]  what to type into each of them once its shell is up
   * @returns {boolean}  false when that window is not open, and so nothing was opened
   */
  wanted(contactId, names, command = null) {
    return this.#tell(contactId, { type: 'open', names, command: cleanCommand(command) || null });
  }

  /** A contact's shells, in the order of their tabs. @param {string} contactId */
  #of(contactId) {
    return [...this.#terminals.values()].filter((t) => t.contactId === contactId);
  }

  /**
   * The shells running for a contact, in the order of their tabs, each with what is on its
   * screen: what a conversation window shows again when it opens.
   * @param {string} contactId
   * @returns {TerminalView[]}
   */
  list(contactId) {
    return this.#of(contactId).map(view);
  }

  /**
   * The user gave a terminal a name of their own, or with '' took it back.
   * @param {string} id
   * @param {string} name
   */
  rename(id, name) {
    const terminal = this.#terminals.get(id);
    if (terminal) terminal.name = cleanTerminalName(name) || null;
  }

  /**
   * The user dragged a contact's terminals into another order, which the window that
   * opens later shows them in.
   * @param {string} contactId
   * @param {string[]} ids  the contact's terminals, as their tabs are now
   */
  reorder(contactId, ids) {
    const mine = this.#of(contactId);
    // Taken out and put back in that order: among another contact's, their place doesn't matter.
    for (const terminal of mine) this.#terminals.delete(terminal.id);
    for (const terminal of inOrder(mine, ids)) this.#terminals.set(terminal.id, terminal);
  }

  // ---- what it prints, and what is typed -----------------------------------------------------------

  #printed(terminal, data) {
    // Its shell is starting up, or has just drawn its prompt: what is to be typed waits for it to finish.
    if (terminal.toType) {
      clearTimeout(terminal.typing);
      terminal.typing = setTimeout(() => this.#typeCommand(terminal), PROMPT_QUIET_MS);
    }
    terminal.drawing.push(data);
    terminal.screen.write(data, () => terminal.drawing.shift());
    terminal.unsent += data;
    terminal.timer ??= setTimeout(() => this.#sendOutput(terminal), SEND_EVERY_MS);
  }

  #sendOutput(terminal) {
    clearTimeout(terminal.timer);
    terminal.timer = null;
    if (!terminal.unsent) return;
    const data = terminal.unsent;
    terminal.unsent = '';
    // With no window open it is kept in `output`, for the one that opens later.
    this.#tell(terminal.contactId, { type: 'output', id: terminal.id, data });
  }

  /**
   * What was typed into a terminal, or pasted. For one that is gone, nothing happens.
   * @param {string} id
   * @param {string} data
   */
  write(id, data) {
    const terminal = this.#terminals.get(id);
    if (!terminal || typeof data !== 'string') return;
    try {
      terminal.pty.write(data);
    } catch {
      // Its shell is just ending: the window hears of that in a moment.
    }
  }

  /**
   * The window drew a terminal at another size: the programs in it are told, and its screen
   * here goes along, so it is drawn at the size they draw for.
   * @param {string} id
   * @param {number} cols
   * @param {number} rows
   */
  resize(id, cols, rows) {
    const terminal = this.#terminals.get(id);
    if (!terminal) return;
    const size = cleanSize({ cols, rows });
    // Once what the shell printed before is on it: that was drawn for the size it had.
    terminal.screen.write('', () => terminal.screen.resize(size.cols, size.rows));
    try {
      terminal.pty.resize(size.cols, size.rows);
    } catch {
      // Its shell is just ending.
    }
  }

  // ---- ending ---------------------------------------------------------------------------------------

  /** The shell has ended by itself: `exit` was typed, say. */
  #exited(terminal, code, signal) {
    // One that was closed is forgotten already, and its window knows.
    if (!this.#terminals.delete(terminal.id)) return;
    clearTimeout(terminal.typing);
    terminal.screen.dispose();
    this.#sendOutput(terminal);
    this.#tell(terminal.contactId, { type: 'ended', id: terminal.id, code: code ?? null, signal: signal || null });
  }

  /**
   * Closes a terminal: its shell is hung up on, as when a terminal's window is closed, and
   * takes what runs in it along. Safe to call for one that is gone.
   * @param {string} id
   */
  close(id) {
    this.#starting.delete(id);
    const terminal = this.#terminals.get(id);
    if (!terminal) return;
    this.#terminals.delete(id);
    clearTimeout(terminal.timer);
    clearTimeout(terminal.typing);
    terminal.screen.dispose();
    try {
      terminal.pty.kill();
    } catch {
      // It ended in the meantime.
    }
  }

  /**
   * Closes a contact's terminals: it was deleted or archived, or works in another folder
   * now. A window that is still open is told, as it didn't ask for this itself.
   */
  closeFor(contactId) {
    const pending = [...this.#starting].filter(([, starting]) => starting.contactId === contactId).map(([id]) => id);
    for (const id of [...pending, ...this.#of(contactId).map((terminal) => terminal.id)]) {
      this.close(id);
      this.#tell(contactId, { type: 'ended', id, code: null, signal: null });
    }
  }

  /** The app quits: no shell outlives it. */
  closeAll() {
    this.#starting.clear();
    for (const id of [...this.#terminals.keys()]) this.close(id);
  }
}
