import headless from '@xterm/headless';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/main/storage/store.js';
import { shellFor, Terminals } from '../src/main/terminals.js';
import {
  cleanNumber,
  cleanSize,
  cleanTerminalName,
  COMFORTABLE_COLS,
  DEFAULT_SIZE,
  FIND_LIMIT,
  findCount,
  findKeyLabel,
  freeNumber,
  inOrder,
  isFindKey,
  NAME_MAX,
  paneRoomFor,
  SCROLLBACK_LINES,
  TERMINAL_PADDING,
  terminalTitle,
} from '../src/shared/terminal.js';
import { matchesShortcut, shortcutKeys, shortcutLabel } from '../src/shared/shortcuts.js';
import { tempDir } from './fixtures/temp-dir.js';

const STORE_DEFAULTS = { defaultProvider: 'claude' };

// macOS hands out temp folders through a symlink; a shell answers with the real path.
const tmp = () => fs.realpathSync(tempDir('cm-terminals-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check` answers with something, and hands that on. */
async function until(check, what = 'it', within = 8000) {
  const deadline = Date.now() + within;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`waited ${within} ms for ${what}`);
    await sleep(10);
  }
}

/** Stands in for node-pty: every shell "started" is kept, to print and to end from the test. */
function fakePty() {
  const started = [];
  const spawn = (file, args, options) => {
    const pty = {
      file,
      args,
      options,
      written: [],
      sizes: [],
      kills: 0,
      onData: (listener) => {
        pty.print = listener;
      },
      onExit: (listener) => {
        pty.end = (exitCode = 0, signal = 0) => listener({ exitCode, signal });
      },
      write: (data) => pty.written.push(data),
      resize: (cols, rows) => pty.sizes.push([cols, rows]),
      kill: () => {
        pty.kills += 1;
      },
    };
    started.push(pty);
    return pty;
  };
  return { spawn, started };
}

/**
 * A store in a folder of its own, and the terminals of its contacts. What a conversation
 * window would be told is kept in `events`; `world.watching` says whether one is open.
 */
function setup(options = {}) {
  const store = new Store(tmp(), STORE_DEFAULTS);
  const events = [];
  const world = { watching: true };
  const { spawn, started } = fakePty();
  const terminals = new Terminals({
    store,
    send: (contactId, event) => {
      if (world.watching) events.push({ contactId, ...event });
      return world.watching;
    },
    spawn,
    env: { SHELL: '/bin/zsh', PATH: '/usr/bin' },
    platform: 'darwin',
    ...options,
  });
  const contact = (cwd = tmp(), name = 'Claude') =>
    store.addContact({ provider: 'claude', name, cwd, model: '', permissionMode: 'default' });
  /** What the window was told a terminal printed, all of it. */
  const printed = (id) =>
    events
      .filter((e) => e.type === 'output' && e.id === id)
      .map((e) => e.data)
      .join('');
  return { store, terminals, events, world, started, contact, printed };
}

/**
 * What a terminal shows once it is given `output`, as a window draws it: its lines, without
 * the empty ones at the end, and where its cursor is.
 * @param {{ output: string, cols: number, rows: number }} view
 */
function drawn({ output, cols, rows }) {
  // Reading its lines is one of xterm's proposed parts.
  const term = new headless.Terminal({ cols, rows, scrollback: SCROLLBACK_LINES, allowProposedApi: true });
  return new Promise((resolve) => {
    term.write(output, () => {
      const buffer = term.buffer.active;
      const lines = Array.from({ length: buffer.length }, (_, y) => buffer.getLine(y).translateToString(true));
      while (lines.length && !lines.at(-1)) lines.pop();
      resolve({ lines, cursor: [buffer.cursorX, buffer.baseY + buffer.cursorY] });
      term.dispose();
    });
  });
}

/** What a window that opened now would show of a contact's terminals, once their screens are drawn. */
async function shown(terminals, contactId) {
  await sleep(30);
  return Promise.all(terminals.list(contactId).map(drawn));
}

// ---- starting a shell ---------------------------------------------------------------------------

test("a terminal is the user's own shell, in the contact's folder, at the size its window drew", async () => {
  const { terminals, started, contact } = setup();
  const claude = contact();
  const opened = await terminals.open(claude.id, { id: 't1', cols: 61, rows: 28 });
  assert.deepEqual(opened, { id: 't1', number: 1, name: null, output: '', cols: 61, rows: 28 });
  assert.equal(started.length, 1);
  const [{ file, args, options }] = started;
  assert.deepEqual([file, args], ['/bin/zsh', ['-l']]);
  assert.equal(options.cwd, claude.cwd);
  assert.deepEqual([options.cols, options.rows], [61, 28]);
  assert.equal(options.name, 'xterm-256color');
  // What it inherits, and what tells programs how much the window can draw.
  assert.equal(options.env.PATH, '/usr/bin');
  assert.equal(options.env.TERM, 'xterm-256color');
  assert.equal(options.env.COLORTERM, 'truecolor');
});

test('which shell, and how it is started, goes by the computer', () => {
  assert.deepEqual(shellFor({ SHELL: '/bin/zsh' }, 'darwin'), { file: '/bin/zsh', args: ['-l'] });
  assert.deepEqual(shellFor({ SHELL: '/usr/bin/fish' }, 'linux'), { file: '/usr/bin/fish', args: [] });
  assert.deepEqual(shellFor({}, 'linux'), { file: '/bin/sh', args: [] });
  assert.deepEqual(shellFor({ COMSPEC: 'C:\\Windows\\cmd.exe' }, 'win32'), { file: 'C:\\Windows\\cmd.exe', args: [] });
  assert.deepEqual(shellFor({}, 'win32'), { file: 'cmd.exe', args: [] });
});

test('a terminal whose window gave no size, or nonsense, starts at 80 by 24', async () => {
  const { terminals, started, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  await terminals.open(claude.id, { id: 't2', cols: 0, rows: -3 });
  await terminals.open(claude.id, { id: 't3', cols: '80', rows: 2.5 });
  for (const { options } of started) assert.deepEqual([options.cols, options.rows], [80, 24]);
});

test('no shell is started for a contact that is gone, or in a folder that is', async () => {
  const { terminals, started, store, contact } = setup();
  await assert.rejects(terminals.open('nobody', { id: 't1' }), /no longer exists/);
  const gone = contact(path.join(tmp(), 'removed'));
  await assert.rejects(terminals.open(gone.id, { id: 't1' }), /isn’t there any more/);
  assert.equal(started.length, 0);
  assert.deepEqual(terminals.list(gone.id), []);
  assert.ok(store.getContact(gone.id), 'the contact itself is left alone');
});

test('a terminal needs a name of its own', async () => {
  const { terminals, started, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  await assert.rejects(terminals.open(claude.id, { id: 't1' }), /open already/);
  await assert.rejects(terminals.open(claude.id, {}), /open already/);
  await assert.rejects(terminals.open(claude.id), /open already/);
  await assert.rejects(terminals.open(claude.id, { id: 7 }), /open already/);
  assert.equal(started.length, 1);
});

test('a shell that can’t be started says so, and leaves nothing behind', async () => {
  const { terminals, contact } = setup({
    spawn: () => {
      throw new Error('posix_spawnp failed');
    },
  });
  const claude = contact();
  await assert.rejects(terminals.open(claude.id, { id: 't1' }), /\/bin\/zsh could not be started: posix_spawnp failed/);
  assert.deepEqual(terminals.list(claude.id), []);
});

test('a terminal keeps the number its window gave it, for the window that opens later', async () => {
  const { terminals, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1', number: 1 });
  await terminals.open(claude.id, { id: 't2', number: 3 });
  // A number that is none is the first.
  await terminals.open(claude.id, { id: 't3', number: 0 });
  await terminals.open(claude.id, { id: 't4', number: '2' });
  assert.deepEqual(
    terminals.list(claude.id).map((t) => [t.id, t.number]),
    [
      ['t1', 1],
      ['t2', 3],
      ['t3', 1],
      ['t4', 1],
    ]
  );
});

test('a terminal keeps the name the user gave it, until they take it back', async () => {
  const { terminals, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1', number: 1 });
  await terminals.open(claude.id, { id: 't2', number: 2 });
  terminals.rename('t2', '  dev   server\n');
  assert.deepEqual(
    terminals.list(claude.id).map((t) => [t.id, t.name]),
    [
      ['t1', null],
      ['t2', 'dev server'],
    ]
  );
  terminals.rename('t2', '   ');
  assert.equal(terminals.list(claude.id)[1].name, null);
  // For one that is gone, nothing happens.
  terminals.rename('nothing', 'x');
});

test('a terminal that was asked for by name has it from the start', async () => {
  const { terminals, contact } = setup();
  const claude = contact();
  const opened = await terminals.open(claude.id, { id: 't1', number: 1, name: '  dev   server\n' });
  assert.equal(opened.name, 'dev server');
  assert.equal(terminals.list(claude.id)[0].name, 'dev server');
  assert.equal((await terminals.open(claude.id, { id: 't2', number: 2, name: '  ' })).name, null);
});

test('more terminals are asked of the contact’s window, which opens them as it opens its own', () => {
  const { terminals, contact, events, started } = setup();
  const claude = contact();
  assert.equal(terminals.wanted(claude.id, ['dev server', null]), true);
  assert.deepEqual(events, [{ contactId: claude.id, type: 'open', names: ['dev server', null], command: null }]);
  // With something to run in them, which the window passes back for each one it opens.
  terminals.wanted(claude.id, [null], '  claude ');
  assert.deepEqual(events[1], { contactId: claude.id, type: 'open', names: [null], command: 'claude' });
  // Nothing is started here: the window gives each its tab, its number and its size first.
  assert.equal(started.length, 0);
});

test('with no window open there is nobody to ask for a terminal', () => {
  const { terminals, contact, events, world } = setup();
  world.watching = false;
  assert.equal(terminals.wanted(contact().id, [null]), false);
  assert.deepEqual(events, []);
});

// ---- opened to run something ---------------------------------------------------------------------

test('a terminal opened to run a command has it typed in once its shell has drawn its prompt', async () => {
  const { terminals, contact, started } = setup();
  await terminals.open(contact().id, { id: 't1', number: 1, command: '  claude ' });
  const [pty] = started;
  assert.deepEqual(pty.written, [], 'not before the shell is up: it would be shown twice, or not run');
  pty.print('Last login: today\r\n');
  pty.print('safa@mac shop % ');
  assert.deepEqual(pty.written, [], 'and not while it is still printing');
  await until(() => pty.written.length > 0);
  // As the user would type it: the command, and Enter.
  assert.deepEqual(pty.written, ['claude\r']);
});

test('it is typed once, whatever the shell prints after', async () => {
  const { terminals, contact, started } = setup();
  await terminals.open(contact().id, { id: 't1', number: 1, command: 'npm run dev' });
  const [pty] = started;
  pty.print('% ');
  await until(() => pty.written.length > 0);
  pty.print('ready on http://localhost:3000\r\n');
  await sleep(400);
  assert.deepEqual(pty.written, ['npm run dev\r']);
});

test('a terminal that was not opened to run anything has nothing typed into it', async () => {
  const { terminals, contact, started } = setup();
  await terminals.open(contact().id, { id: 't1', number: 1 });
  await terminals.open(contact().id, { id: 't2', number: 2, command: '   ' });
  for (const pty of started) pty.print('% ');
  await sleep(400);
  assert.deepEqual(
    started.map((pty) => pty.written),
    [[], []]
  );
});

test('a terminal closed before its shell was up is typed into no more', async () => {
  const { terminals, contact, started } = setup();
  await terminals.open(contact().id, { id: 't1', number: 1, command: 'claude' });
  started[0].print('% ');
  terminals.close('t1');
  await sleep(400);
  assert.deepEqual(started[0].written, []);
});

test('a contact’s terminals come back in the order their tabs were dragged into', async () => {
  const { terminals, contact } = setup();
  const claude = contact();
  const other = contact(tmp(), 'Codex');
  await terminals.open(claude.id, { id: 't1' });
  await terminals.open(other.id, { id: 'o1' });
  await terminals.open(claude.id, { id: 't2' });
  await terminals.open(claude.id, { id: 't3' });
  const order = (id) => terminals.list(id).map((t) => t.id);
  terminals.reorder(claude.id, ['t3', 'plan-7', 't1', 't2']);
  assert.deepEqual(order(claude.id), ['t3', 't1', 't2']);
  // One the window didn't name, opened at that very moment, keeps its place after the others.
  terminals.reorder(claude.id, ['t2', 't3']);
  assert.deepEqual(order(claude.id), ['t2', 't3', 't1']);
  // Another contact's are not touched, and not given away by naming them.
  terminals.reorder(claude.id, ['o1', 't1']);
  assert.deepEqual(order(claude.id), ['t1', 't2', 't3']);
  assert.deepEqual(order(other.id), ['o1']);
  terminals.reorder('nobody', ['t1']);
  terminals.reorder(claude.id, null);
  assert.deepEqual(order(claude.id), ['t1', 't2', 't3']);
  // Still the same shells: what is typed reaches them.
  terminals.write('t3', 'ls\r');
  terminals.close('t2');
  assert.deepEqual(order(claude.id), ['t1', 't3']);
});

// ---- what it prints, and what is typed ------------------------------------------------------------

test('what a shell prints reaches its window in order, a burst of it in one piece', async () => {
  const { terminals, started, events, contact, printed } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  for (const piece of ['one\r\n', 'two\r\n', '\x1b[32mthree\x1b[0m']) started[0].print(piece);
  await until(() => printed('t1').endsWith('three\x1b[0m'), 'the output');
  // As the shell printed it, colours and all: the window is a terminal.
  assert.equal(printed('t1'), 'one\r\ntwo\r\n\x1b[32mthree\x1b[0m');
  assert.equal(events.length, 1, 'printed in one go, sent in one go');
  assert.deepEqual(events[0], { contactId: claude.id, type: 'output', id: 't1', data: printed('t1') });
});

test('a window that opens later is shown what is on the screens of its terminals', async () => {
  const { terminals, started, events, world, contact } = setup();
  const claude = contact();
  const other = contact(tmp(), 'Codex');
  world.watching = false;
  await terminals.open(claude.id, { id: 't1' });
  await terminals.open(other.id, { id: 't2' });
  await terminals.open(claude.id, { id: 't3' });
  started[0].print('$ npm test\r\n');
  started[0].print('ok\r\n');
  started[2].print('$ ');
  await sleep(30);
  assert.deepEqual(events, [], 'nobody was there to be told');
  // Its own terminals, the oldest first, and not another contact's, at the size their shells have.
  const listed = terminals.list(claude.id);
  assert.deepEqual(
    listed.map(({ id, number, name, cols, rows }) => ({ id, number, name, cols, rows })),
    [
      { id: 't1', number: 1, name: null, cols: 80, rows: 24 },
      { id: 't3', number: 1, name: null, cols: 80, rows: 24 },
    ]
  );
  assert.deepEqual(await shown(terminals, claude.id), [
    { lines: ['$ npm test', 'ok'], cursor: [0, 2] },
    { lines: ['$ '], cursor: [2, 0] },
  ]);
  assert.deepEqual(terminals.list(other.id), [{ id: 't2', number: 1, name: null, output: '', cols: 80, rows: 24 }]);
  assert.deepEqual(terminals.list('nobody'), []);
});

test('what a shell printed a moment ago is shown too, though it is not on its screen yet', async () => {
  const { terminals, started, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  started[0].print('$ ');
  started[0].print('ls\r\n');
  // Asked straight away, before its screen was drawn.
  const [view] = terminals.list(claude.id);
  assert.deepEqual(await drawn(view), { lines: ['$ ls'], cursor: [0, 1] });
});

// zsh draws its prompt again each time its terminal changes size. It goes back to where the prompt
// began as it was laid out at the size before, without the terminal folding its lines over again.
const PROMPT = 'someone@Their-MacBook-Pro buddylist-2 % ';
const REDRAW = '\r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J';
// Narrower than the prompt, on one line before; and wider again, from the two it then took.
const REDRAWN_NARROWER = `${REDRAW}${PROMPT}`;
const REDRAWN_WIDER = `\r\r\x1b[A${REDRAW.slice(2)}${PROMPT}`;

test('a window that opens later is shown the prompt once, however often the shell drew it for another size', async () => {
  const { terminals, started, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1', cols: 80, rows: 10 });
  const shell = started[0];
  let printed = `${PROMPT}echo one\r\none\r\n${PROMPT}`;
  shell.print(printed);
  // The pane is made narrow for a moment, and wide again: twice.
  for (let i = 0; i < 2; i += 1) {
    terminals.resize('t1', 29, 10);
    shell.print(REDRAWN_NARROWER);
    terminals.resize('t1', 80, 10);
    shell.print(REDRAWN_WIDER);
    printed += REDRAWN_NARROWER + REDRAWN_WIDER;
  }
  const screen = { lines: [`${PROMPT}echo one`, 'one', PROMPT], cursor: [PROMPT.length, 2] };
  assert.deepEqual(await shown(terminals, claude.id), [screen]);
  // As it was printed, it would not come out so at either size: a line is lost, or the prompt left behind.
  assert.notDeepEqual(await drawn({ output: printed, cols: 80, rows: 10 }), screen);
  assert.ok(
    (await drawn({ output: printed, cols: 29, rows: 10 })).lines.filter((l) => l === PROMPT.slice(0, 29)).length > 2
  );
});

test('only the last lines a shell printed are kept, as many as its window keeps', async () => {
  const { terminals, started, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1', cols: 80, rows: 10 });
  const count = SCROLLBACK_LINES + 100;
  for (let i = 1; i <= count; i += 1) started[0].print(`line ${i}\r\n`);
  const [{ lines }] = await shown(terminals, claude.id);
  // Its screen and the lines above it, the last of them the one its cursor is on.
  assert.equal(lines.length, SCROLLBACK_LINES + 10 - 1);
  assert.equal(lines[0], `line ${count - lines.length + 1}`);
  assert.equal(lines.at(-1), `line ${count}`);
});

test('what is typed goes to the shell, and so does a new size', async () => {
  const { terminals, started, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  terminals.write('t1', 'ls\r');
  terminals.write('t1', '\x03');
  terminals.resize('t1', 120, 40);
  // A size no shell can live with is put right, not passed on.
  terminals.resize('t1', 0, 9999);
  assert.deepEqual(started[0].written, ['ls\r', '\x03']);
  assert.deepEqual(started[0].sizes, [
    [120, 40],
    [80, 300],
  ]);
  // Its screen here goes along.
  await sleep(30);
  assert.deepEqual(
    terminals.list(claude.id).map(({ cols, rows }) => [cols, rows]),
    [[80, 300]]
  );
});

test('typing into a terminal that is gone, or was never there, does nothing', async () => {
  const { terminals, started, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  terminals.write('nothing', 'ls\r');
  terminals.resize('nothing', 80, 24);
  terminals.close('nothing');
  terminals.write('t1', { not: 'text' });
  assert.deepEqual(started[0].written, []);
  // A shell that is just ending refuses both: that is not the window's problem.
  started[0].write = () => {
    throw new Error('EIO');
  };
  started[0].resize = () => {
    throw new Error('ioctl(2) failed, EBADF');
  };
  terminals.write('t1', 'ls\r');
  terminals.resize('t1', 80, 24);
});

// ---- ending -----------------------------------------------------------------------------------------

test('a shell that ends by itself is told to its window, after the last it printed', async () => {
  const { terminals, started, events, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  started[0].print('logout\r\n');
  started[0].end(3);
  assert.deepEqual(
    events.map((e) => [e.type, e.data ?? e.code]),
    [
      ['output', 'logout\r\n'],
      ['ended', 3],
    ]
  );
  assert.deepEqual(events[1], { contactId: claude.id, type: 'ended', id: 't1', code: 3, signal: null });
  assert.deepEqual(terminals.list(claude.id), []);
  // Nothing more is sent for it once the timer of its last output comes round.
  await sleep(30);
  assert.equal(events.length, 2);
});

test('a shell ended by a signal says which', async () => {
  const { terminals, started, events, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  started[0].end(0, 9);
  assert.deepEqual(events, [{ contactId: claude.id, type: 'ended', id: 't1', code: 0, signal: 9 }]);
});

test('closing a terminal hangs up on its shell, and its window is not told what it asked for', async () => {
  const { terminals, started, events, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  await terminals.open(claude.id, { id: 't2' });
  started[0].print('half a line');
  terminals.close('t1');
  assert.equal(started[0].kills, 1);
  assert.equal(started[1].kills, 0);
  assert.deepEqual(terminals.list(claude.id), [{ id: 't2', number: 1, name: null, output: '', cols: 80, rows: 24 }]);
  // The shell then ends, as asked.
  started[0].end(0, 1);
  await sleep(30);
  assert.deepEqual(events, []);
  // Closed twice, it is hung up on once.
  terminals.close('t1');
  assert.equal(started[0].kills, 1);
});

test('a shell that is already gone when it is closed is no trouble', async () => {
  const { terminals, started, contact } = setup();
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  started[0].kill = () => {
    throw new Error('ESRCH');
  };
  terminals.close('t1');
  assert.deepEqual(terminals.list(claude.id), []);
});

test('a contact that goes takes its terminals along, and a window still open is told', async () => {
  const { terminals, started, events, contact } = setup();
  const claude = contact();
  const other = contact(tmp(), 'Codex');
  await terminals.open(claude.id, { id: 't1' });
  await terminals.open(other.id, { id: 't2' });
  await terminals.open(claude.id, { id: 't3' });
  terminals.closeFor(claude.id);
  assert.deepEqual(
    started.map((pty) => pty.kills),
    [1, 0, 1]
  );
  assert.deepEqual(events, [
    { contactId: claude.id, type: 'ended', id: 't1', code: null, signal: null },
    { contactId: claude.id, type: 'ended', id: 't3', code: null, signal: null },
  ]);
  assert.deepEqual(terminals.list(claude.id), []);
  assert.equal(terminals.list(other.id).length, 1);
});

test('an archived contact cannot start a terminal or read its project environment', async () => {
  const { terminals, store, started, contact } = setup({
    environment: () => assert.fail('an archived contact must not prepare a shell'),
  });
  const claude = contact();
  store.updateContact(claude.id, { archived: true });
  await assert.rejects(terminals.open(claude.id, { id: 't1' }), /Restore this contact/);
  assert.deepEqual(started, []);
  assert.deepEqual(terminals.list(claude.id), []);
});

for (const restored of [false, true]) {
  test(`archiving cancels a pending shell${restored ? ' even when restored before its environment is ready' : ''}`, async () => {
    const ready = Promise.withResolvers();
    const { terminals, store, started, events, contact } = setup({ environment: () => ready.promise });
    const claude = contact();
    const opening = terminals.open(claude.id, { id: 'pending', command: 'npm start' });
    const rejected = assert.rejects(opening, /closed before its shell started/);
    store.updateContact(claude.id, { archived: true });
    terminals.closeFor(claude.id);
    terminals.closeFor(claude.id);
    if (restored) store.updateContact(claude.id, { archived: false });
    ready.resolve({});
    await rejected;
    assert.deepEqual(started, [], 'the cancelled shell and its command never start');
    assert.deepEqual(terminals.list(claude.id), []);
    assert.deepEqual(events, [{ contactId: claude.id, type: 'ended', id: 'pending', code: null, signal: null }]);
  });
}

test('a contact archived while its environment loads is checked again before spawning', async () => {
  const ready = Promise.withResolvers();
  const { terminals, store, started, contact } = setup({ environment: () => ready.promise });
  const claude = contact();
  const opening = terminals.open(claude.id, { id: 'pending' });
  const rejected = assert.rejects(opening, /Restore this contact/);
  store.updateContact(claude.id, { archived: true });
  ready.resolve({});
  await rejected;
  assert.deepEqual(started, []);
  assert.deepEqual(terminals.list(claude.id), []);
});

test('closing a pending id cancels only that request, including when the id is reused', async () => {
  const environments = [];
  const { terminals, started, events, contact } = setup({
    environment: () => {
      const ready = Promise.withResolvers();
      environments.push(ready);
      return ready.promise;
    },
  });
  const claude = contact();
  const old = terminals.open(claude.id, { id: 'reused' });
  const rejected = assert.rejects(old, /closed before its shell started/);
  await assert.rejects(terminals.open(claude.id, { id: 'reused' }), /open already/);
  terminals.close('reused');
  const fresh = terminals.open(claude.id, { id: 'reused' });
  environments[0].resolve({});
  await rejected;
  assert.deepEqual(started, []);
  await assert.rejects(
    terminals.open(claude.id, { id: 'reused' }),
    /open already/,
    'the old cleanup retains the new ticket'
  );
  environments[1].resolve({});
  assert.equal((await fresh).id, 'reused');
  assert.equal(started.length, 1);
  assert.deepEqual(events, [], 'an explicit close does not echo an ended event');
  terminals.closeAll();
});

test('closing one contact cancels its pending starts without cancelling another contact', async () => {
  const ready = Promise.withResolvers();
  const { terminals, started, events, contact } = setup({ environment: () => ready.promise });
  const claude = contact();
  const other = contact(tmp(), 'Codex');
  const first = terminals.open(claude.id, { id: 'first' });
  const second = terminals.open(other.id, { id: 'second' });
  const rejected = assert.rejects(first, /closed before its shell started/);
  terminals.closeFor(claude.id);
  ready.resolve({});
  await rejected;
  await second;
  assert.equal(started.length, 1);
  assert.equal(started[0].options.cwd, other.cwd);
  assert.deepEqual(terminals.list(claude.id), []);
  assert.deepEqual(
    terminals.list(other.id).map((terminal) => terminal.id),
    ['second']
  );
  assert.deepEqual(events, [{ contactId: claude.id, type: 'ended', id: 'first', code: null, signal: null }]);
  terminals.closeAll();
});

test('quitting cancels every pending shell before the environment becomes ready', async () => {
  const ready = Promise.withResolvers();
  const { terminals, started, contact } = setup({ environment: () => ready.promise });
  const first = contact();
  const second = contact(tmp(), 'Codex');
  const rejected = [
    assert.rejects(terminals.open(first.id, { id: 'first' }), /closed before its shell started/),
    assert.rejects(terminals.open(second.id, { id: 'second' }), /closed before its shell started/),
  ];
  terminals.closeAll();
  ready.resolve({});
  await Promise.all(rejected);
  assert.deepEqual(started, []);
  assert.deepEqual([...terminals.list(first.id), ...terminals.list(second.id)], []);
});

test('a failed environment leaves the terminal id available for a later attempt', async () => {
  let failed = true;
  const { terminals, started, contact } = setup({
    environment: () => {
      if (failed) throw new Error('Environment unavailable');
      return {};
    },
  });
  const claude = contact();
  await assert.rejects(terminals.open(claude.id, { id: 'retry' }), /Environment unavailable/);
  failed = false;
  assert.equal((await terminals.open(claude.id, { id: 'retry' })).id, 'retry');
  assert.equal(started.length, 1);
  terminals.closeAll();
});

test('no shell outlives the app', async () => {
  const { terminals, started, contact } = setup();
  const claude = contact();
  const other = contact(tmp(), 'Codex');
  await terminals.open(claude.id, { id: 't1' });
  await terminals.open(other.id, { id: 't2' });
  terminals.closeAll();
  assert.deepEqual(
    started.map((pty) => pty.kills),
    [1, 1]
  );
  assert.deepEqual([...terminals.list(claude.id), ...terminals.list(other.id)], []);
});

test('a window that is going away is no reason for a shell to trip', async () => {
  const { terminals, started, contact } = setup({
    send: () => {
      throw new Error('Object has been destroyed');
    },
  });
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  started[0].print('still here\r\n');
  await sleep(30);
  assert.deepEqual(await shown(terminals, claude.id), [{ lines: ['still here'], cursor: [0, 1] }]);
  started[0].end(0);
  assert.deepEqual(terminals.list(claude.id), []);
});

// ---- what both sides agree on -----------------------------------------------------------------------

test('a size is whole numbers within what a terminal can be', () => {
  assert.deepEqual(cleanSize({ cols: 61, rows: 28 }), { cols: 61, rows: 28 });
  assert.deepEqual(cleanSize({ cols: 1, rows: 1 }), { cols: 1, rows: 1 });
  assert.deepEqual(cleanSize({ cols: 100000, rows: 100000 }), { cols: 500, rows: 300 });
  for (const nonsense of [null, undefined, {}, { cols: NaN, rows: Infinity }, { cols: '61', rows: null }]) {
    assert.deepEqual(cleanSize(nonsense), DEFAULT_SIZE);
  }
});

// The terminal's keys as they start, on a Mac and elsewhere.
const MAC = shortcutKeys({}, 'mac');
const OTHER = shortcutKeys({}, 'linux');
const key = (over) => ({
  code: 'KeyJ',
  key: 'j',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});
const isTerminalKey = (e, keys) => matchesShortcut(e, keys.terminal);
const isNewTerminalKey = (e, keys) => matchesShortcut(e, keys.newTerminal);

test('⌘J is the terminal key on a Mac, and nothing near it is', () => {
  assert.equal(isTerminalKey(key({ metaKey: true }), MAC), true);
  // Caps Lock is no reason for it to stop working.
  assert.equal(isTerminalKey(key({ metaKey: true, key: 'J' }), MAC), true);
  assert.equal(isTerminalKey(key(), MAC), false);
  // Ctrl+J is the shell's there: it ends a line.
  assert.equal(isTerminalKey(key({ ctrlKey: true }), MAC), false);
  assert.equal(isTerminalKey(key({ metaKey: true, ctrlKey: true }), MAC), false);
  assert.equal(isTerminalKey(key({ metaKey: true, altKey: true }), MAC), false);
  assert.equal(isTerminalKey(key({ metaKey: true, shiftKey: true }), MAC), false);
  assert.equal(isTerminalKey(key({ metaKey: true, code: 'KeyK', key: 'k' }), MAC), false);
  assert.equal(isTerminalKey({ metaKey: true }, MAC), false, 'a key event without a key');
});

test('⌘T opens another terminal on a Mac, and the two are never taken for each other', () => {
  const t = (over) => key({ code: 'KeyT', key: 't', ...over });
  assert.equal(isNewTerminalKey(t({ metaKey: true }), MAC), true);
  assert.equal(isNewTerminalKey(t({ metaKey: true, key: 'T' }), MAC), true);
  assert.equal(isNewTerminalKey(t(), MAC), false);
  assert.equal(isNewTerminalKey(t({ ctrlKey: true }), MAC), false);
  assert.equal(isNewTerminalKey(t({ metaKey: true, shiftKey: true }), MAC), false);
  assert.equal(isNewTerminalKey(t({ metaKey: true, altKey: true }), MAC), false);
  assert.equal(isNewTerminalKey(key({ metaKey: true }), MAC), false);
  assert.equal(isTerminalKey(t({ metaKey: true }), MAC), false);
});

test('without a ⌘ key it is Ctrl+J, and Ctrl+Shift+T for another: Ctrl+T alone stays the shell’s', () => {
  const t = (over) => key({ code: 'KeyT', key: 't', ...over });
  assert.equal(isTerminalKey(key({ ctrlKey: true }), OTHER), true);
  assert.equal(isTerminalKey(key({ metaKey: true }), OTHER), false);
  assert.equal(isTerminalKey(key({ ctrlKey: true, shiftKey: true }), OTHER), false);
  assert.equal(isNewTerminalKey(t({ ctrlKey: true, shiftKey: true, key: 'T' }), OTHER), true);
  assert.equal(isNewTerminalKey(t({ ctrlKey: true }), OTHER), false);
  assert.equal(isNewTerminalKey(t({ metaKey: true, shiftKey: true }), OTHER), false);
  assert.deepEqual(shortcutKeys({}, 'windows').terminal, OTHER.terminal);
});

test('menus and tooltips write the keys as the keyboard has them', () => {
  assert.deepEqual([shortcutLabel(MAC.terminal, true), shortcutLabel(MAC.newTerminal, true)], ['⌘J', '⌘T']);
  assert.deepEqual([shortcutLabel(OTHER.terminal), shortcutLabel(OTHER.newTerminal)], ['Ctrl+J', 'Ctrl+Shift+T']);
});

test('keys chosen for the terminal take the place of ⌘J, which is then nothing of the terminal’s', () => {
  const keys = shortcutKeys({ shortcuts: { terminal: 'F4' } }, 'mac');
  assert.equal(isTerminalKey(key({ code: 'F4', key: 'F4' }), keys), true);
  assert.equal(isTerminalKey(key({ metaKey: true }), keys), false);
  assert.equal(isNewTerminalKey(key({ code: 'KeyT', key: 't', metaKey: true }), keys), true, 'the other stays');
});

// Find keeps its keys, as Copy and Paste do: it is not one of the shortcuts you can change.
const ON_MAC = true;

test('Find’s keys are written as the keyboard has them', () => {
  assert.deepEqual([findKeyLabel(ON_MAC, false), findKeyLabel(ON_MAC, true)], ['⌘F', '⌘F']);
  assert.deepEqual([findKeyLabel(!ON_MAC, false), findKeyLabel(!ON_MAC, true)], ['Ctrl+F', 'Ctrl+Shift+F']);
});

const IN_TERMINAL = true;
const f = (over) => key({ code: 'KeyF', key: 'f', ...over });

test('⌘F finds on a Mac, in a terminal as in the conversation', () => {
  for (const inTerminal of [IN_TERMINAL, !IN_TERMINAL]) {
    assert.equal(isFindKey(f({ metaKey: true }), ON_MAC, inTerminal), true);
    // Caps Lock is no reason for it to stop working.
    assert.equal(isFindKey(f({ metaKey: true, key: 'F' }), ON_MAC, inTerminal), true);
    assert.equal(isFindKey(f(), ON_MAC, inTerminal), false);
    // Ctrl+F is the shell's there, and nothing of the window's.
    assert.equal(isFindKey(f({ ctrlKey: true }), ON_MAC, inTerminal), false);
    assert.equal(isFindKey(f({ metaKey: true, shiftKey: true }), ON_MAC, inTerminal), false);
    assert.equal(isFindKey(f({ metaKey: true, altKey: true }), ON_MAC, inTerminal), false);
    assert.equal(isFindKey(f({ metaKey: true, ctrlKey: true }), ON_MAC, inTerminal), false);
    assert.equal(isFindKey({ metaKey: true }, ON_MAC, inTerminal), false, 'a key event without a key');
  }
});

test('without a ⌘ key Ctrl+F finds in the conversation, and Ctrl+Shift+F in a terminal: Ctrl+F there is the shell’s', () => {
  assert.equal(isFindKey(f({ ctrlKey: true }), !ON_MAC, !IN_TERMINAL), true);
  assert.equal(isFindKey(f({ ctrlKey: true }), !ON_MAC, IN_TERMINAL), false);
  assert.equal(isFindKey(f({ ctrlKey: true, shiftKey: true, key: 'F' }), !ON_MAC, IN_TERMINAL), true);
  assert.equal(isFindKey(f({ ctrlKey: true, shiftKey: true, key: 'F' }), !ON_MAC, !IN_TERMINAL), false);
  assert.equal(isFindKey(f({ metaKey: true }), !ON_MAC, !IN_TERMINAL), false);
  assert.equal(isFindKey(f({ metaKey: true, shiftKey: true }), !ON_MAC, IN_TERMINAL), false);
  assert.equal(isFindKey(f({ ctrlKey: true, altKey: true }), !ON_MAC, !IN_TERMINAL), false);
});

test('Find is never taken for the keys that go to a terminal or open another', () => {
  for (const mac of [ON_MAC, !ON_MAC]) {
    const keys = mac ? MAC : OTHER;
    const find = f(mac ? { metaKey: true } : { ctrlKey: true, shiftKey: true });
    assert.equal(isTerminalKey(find, keys), false);
    assert.equal(isNewTerminalKey(find, keys), false);
    assert.equal(isFindKey(key(mac ? { metaKey: true } : { ctrlKey: true }), mac, IN_TERMINAL), false);
    assert.equal(isFindKey(key({ key: 't', metaKey: mac, ctrlKey: !mac, shiftKey: !mac }), mac, IN_TERMINAL), false);
  }
});

test('Find says nothing until something is typed', () => {
  assert.equal(findCount('', { resultIndex: -1, resultCount: 0 }), '');
  assert.equal(findCount('', { resultIndex: 2, resultCount: 5 }), '');
  assert.equal(findCount('npm', null), '');
});

test('Find counts from the newest, the one nearest the prompt, as it finds them', () => {
  // The search addon counts from the top: the last of 14 is the newest.
  assert.equal(findCount('error', { resultIndex: 13, resultCount: 14 }), '1 of 14');
  assert.equal(findCount('error', { resultIndex: 12, resultCount: 14 }), '2 of 14');
  assert.equal(findCount('error', { resultIndex: 0, resultCount: 14 }), '14 of 14');
  assert.equal(findCount('error', { resultIndex: 0, resultCount: 1 }), '1 of 1');
});

test('Find says when there is nothing, and how many there are when it is at none of them', () => {
  assert.equal(findCount('nowhere', { resultIndex: -1, resultCount: 0 }), 'No matches');
  assert.equal(findCount('error', { resultIndex: -1, resultCount: 3 }), '3 matches');
  assert.equal(findCount('error', { resultIndex: -1, resultCount: 1 }), '1 match');
  // One it was at that is gone from what it found is none of them.
  assert.equal(findCount('error', { resultIndex: 3, resultCount: 3 }), '3 matches');
});

test('past as many as Find marks, it says only that there are more', () => {
  assert.equal(FIND_LIMIT, 1000);
  assert.equal(findCount('e', { resultIndex: 40, resultCount: FIND_LIMIT }), '1,000+ matches');
  assert.equal(findCount('e', { resultIndex: -1, resultCount: FIND_LIMIT }), '1,000+ matches');
  assert.equal(findCount('e', { resultIndex: 0, resultCount: FIND_LIMIT - 1 }), '999 of 999');
});

test('a new terminal gets the lowest number that is free', () => {
  assert.equal(freeNumber([]), 1);
  assert.equal(freeNumber([1]), 2);
  assert.equal(freeNumber([1, 2, 3]), 4);
  // One that was closed left its number behind.
  assert.equal(freeNumber([1, 3]), 2);
  assert.equal(freeNumber([2, 3]), 1);
  assert.equal(freeNumber([3, 1, 2]), 4);
});

test('a tab says which terminal it is, from the second on', () => {
  assert.equal(terminalTitle(1), 'Terminal');
  assert.equal(terminalTitle(2), 'Terminal 2');
  assert.equal(terminalTitle(12), 'Terminal 12');
  assert.equal(cleanNumber(4), 4);
  for (const nonsense of [0, -1, 1.5, '2', null, undefined, NaN]) assert.equal(cleanNumber(nonsense), 1);
});

test('a tab says the name the user gave its terminal, and its number again once that is taken back', () => {
  assert.equal(terminalTitle(2, 'dev server'), 'dev server');
  assert.equal(terminalTitle(1, 'tests'), 'tests');
  assert.equal(terminalTitle(2, null), 'Terminal 2');
  assert.equal(terminalTitle(2, ''), 'Terminal 2');
});

test('a name is kept on one line, without the room around it, and not endlessly long', () => {
  assert.equal(cleanTerminalName('  dev   server \n'), 'dev server');
  assert.equal(cleanTerminalName('logs\ttail\r\n-f'), 'logs tail -f');
  assert.equal(cleanTerminalName('\x1b[31mred'), '[31mred', 'an escape code would repaint the tab');
  assert.equal(cleanTerminalName('x'.repeat(100)).length, NAME_MAX);
  // Cut at a space, it doesn't end in one.
  assert.equal(cleanTerminalName(`${'x'.repeat(NAME_MAX - 1)} y`), 'x'.repeat(NAME_MAX - 1));
  for (const nothing of ['', '   ', '\n\t', null, undefined]) assert.equal(cleanTerminalName(nothing), '');
  assert.equal(cleanTerminalName(42), '42');
});

test('terminals take the order their tabs were dragged into', () => {
  const terminals = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ids = (list) => list.map((t) => t.id).join('');
  assert.equal(ids(inOrder(terminals, ['c', 'a', 'b'])), 'cab');
  // A plan's tab among them is not one of theirs.
  assert.equal(ids(inOrder(terminals, ['plan-1', 'b', 'a', 'c'])), 'bac');
  // One the order doesn't name keeps its place after the others.
  assert.equal(ids(inOrder(terminals, ['c'])), 'cab');
  assert.equal(ids(inOrder(terminals, ['b', 'c'])), 'bca');
  for (const nonsense of [[], null, undefined, 'cab', {}]) assert.equal(ids(inOrder(terminals, nonsense)), 'abc');
  assert.equal(ids(terminals), 'abc', 'the list it was given is left as it was');
});

test('the pane a terminal asks for has room for 80 columns, the bar it scrolls with and the room around', () => {
  assert.equal(COMFORTABLE_COLS, 80);
  const around = TERMINAL_PADDING.left + TERMINAL_PADDING.right;
  // Menlo at 12px: a letter is a little over 7 pixels wide, and 80 of them never quite a whole number.
  assert.equal(paneRoomFor(80, 7.224609375), 578 + around + 14 + 2);
  assert.equal(paneRoomFor(80, 7), 560 + around + 14 + 2);
  // What is left for the letters is never a pixel short of all 80.
  for (const letter of [6.6, 7.224609375, 7.8, 8.4]) {
    const letters = paneRoomFor(80, letter) - around - 14 - 2;
    assert.equal(Math.floor(letters / letter), 80, `at ${letter}px a letter`);
  }
});

// ---- a real shell -----------------------------------------------------------------------------------

/** node-pty's own way of starting a shell, or null where it wasn't built. */
async function realSpawn() {
  try {
    const pty = await import('node-pty');
    return (pty.default ?? pty).spawn;
  } catch {
    return null;
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

test('a real shell runs on a real terminal, in the folder, at the size given', async (t) => {
  const spawn = process.platform === 'win32' ? null : await realSpawn();
  if (!spawn) return t.skip('node-pty is not there');
  const shells = [];
  const { terminals, contact, printed, events } = setup({
    spawn: (...args) => {
      const pty = spawn(...args);
      shells.push(pty);
      return pty;
    },
    env: { ...process.env, SHELL: '/bin/sh', PS1: '$ ' },
    platform: 'linux',
  });
  t.after(() => terminals.closeAll());
  const claude = contact();
  await terminals.open(claude.id, { id: 't1', cols: 91, rows: 17 });
  terminals.write('t1', 'test -t 0 && echo tty-$((6*7)); pwd; stty size\r');
  await until(() => /tty-42\r\n/.test(printed('t1')) && /\r\n17 91\r\n/.test(printed('t1')), 'the answers');
  assert.ok(printed('t1').includes(`${claude.cwd}\r\n`), printed('t1'));

  terminals.resize('t1', 60, 20);
  terminals.write('t1', 'stty size\r');
  await until(() => /\r\n20 60\r\n/.test(printed('t1')), 'the new size');

  terminals.write('t1', 'exit 3\r');
  const ended = await until(() => events.find((e) => e.type === 'ended'), 'the shell to end');
  assert.equal(ended.code, 3);
  assert.deepEqual(terminals.list(claude.id), []);
});

test('closing a terminal ends its real shell, and what runs in it', async (t) => {
  const spawn = process.platform === 'win32' ? null : await realSpawn();
  if (!spawn) return t.skip('node-pty is not there');
  const shells = [];
  const { terminals, contact, printed } = setup({
    spawn: (...args) => {
      const pty = spawn(...args);
      shells.push(pty);
      return pty;
    },
    env: { ...process.env, SHELL: '/bin/sh', PS1: '$ ' },
    platform: 'linux',
  });
  t.after(() => terminals.closeAll());
  const claude = contact();
  await terminals.open(claude.id, { id: 't1' });
  // Something that would run for a minute, in the foreground, as a dev server does.
  terminals.write('t1', "sh -c 'echo child=$$; exec sleep 60'\r");
  const child = Number((await until(() => printed('t1').match(/child=(\d+)\r\n/), 'the child'))[1]);
  assert.ok(alive(shells[0].pid) && alive(child));
  terminals.close('t1');
  await until(() => !alive(shells[0].pid) && !alive(child), 'the shell and its child to be gone');
});
