import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { isPortFree, Runs, runToEnd, spawnArgs } from '../src/main/runs.js';
import { describeProject } from '../src/main/run-command.js';
import { Store } from '../src/main/storage/store.js';
import { OUTPUT_KEPT } from '../src/shared/run-output.js';
import { tempDir } from './fixtures/temp-dir.js';

// These tests start real commands through /bin/sh and stop them again.
const POSIX = process.platform !== 'win32';
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const opts = { skip: !POSIX };

const STORE_DEFAULTS = { defaultProvider: 'claude' };
// Away from the ports the app itself hands out, and from another run of these tests.
const FIRST_PORT = 20000 + (process.pid % 900) * 10;
const PORTS = { first: FIRST_PORT, last: FIRST_PORT + 990, step: 10 };
// How long a command gets to stop by itself here: short, so that the tests about killing are quick.
const GRACE_MS = 250;

// macOS hands out temp folders through a symlink; git and the shell answer with the real path.
const tmp = () => fs.realpathSync(tempDir('cm-runs-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check` answers with something, and hands that on. */
async function until(check, what = 'it', within = 8000) {
  const deadline = Date.now() + within;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`waited ${within} ms for ${what}`);
    await sleep(15);
  }
}

/** Whether a process is still running. One that was killed and only waits to be collected is not. */
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch (err) {
    return err.code === 'EPERM';
  }
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  return state !== '' && !state.startsWith('Z');
}

/** What a conversation window opened now would be shown first: the contact's oldest run, if it has one. */
const showing = (runs, contactId) => runs.state(contactId)[0] ?? null;

/** None of `pids` is left. Looks more than once: the last of a process takes a moment to go. */
const gone = (...pids) => until(() => !pids.some(alive), `${pids} to be gone`, 2000);

/**
 * A store in a folder of its own, and the runs of its contacts. What a conversation window
 * would be told is kept in `events`; `world.watching` says whether a window is open at all,
 * and what was said while none was is in `world.unheard`.
 */
function setup(t, options = {}) {
  const dir = tmp();
  const store = new Store(dir, STORE_DEFAULTS);
  const events = [];
  const world = { watching: true, unheard: [] };
  const runs = new Runs({
    store,
    send: (contactId, event) => {
      (world.watching ? events : world.unheard).push({ contactId, ...event });
      return world.watching;
    },
    shell: '/bin/sh',
    graceMs: GRACE_MS,
    ports: PORTS,
    ...options,
  });
  // Whatever a test leaves running goes with it, also when it failed half way.
  t.after(() => runs.killAll());
  const contact = (cwd = tmp(), name = 'Claude') =>
    store.addContact({ provider: 'claude', name, cwd, model: '', permissionMode: 'default' });
  /** Everything the command of `run` has printed so far, as its window was told. */
  const printed = (run) =>
    events
      .filter((event) => event.type === 'output' && event.id === run.id)
      .map((event) => event.text)
      .join('');
  const ended = (run) => until(() => events.find((e) => e.type === 'ended' && e.id === run.id), 'the command to end');
  /** Starts `command` for a new contact in a folder of its own. */
  const started = async (command, cwd) => {
    const who = contact(cwd);
    await runs.setCommand(who.id, command);
    return { who, run: await runs.start(who.id) };
  };
  /** The number a command printed after `name=`. */
  const pidOf = async (run, name) =>
    Number(await until(() => printed(run).match(new RegExp(`${name}=(\\d+)`))?.[1], `${name}= in the output`));
  return { dir, store, runs, events, world, contact, printed, ended, started, pidOf };
}

/** Something else listening on a port. */
function listen(t, port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    t.after(() => server.close());
    server.once('error', reject);
    server.listen({ port, host }, () => resolve(server));
  });
}

const closed = (server) => new Promise((resolve) => server.close(resolve));

// ---- a port that is free -----------------------------------------------------------------------------

test('a port is free until something listens on it, on this computer alone or on every address', async (t) => {
  const port = PORTS.last + 3;
  assert.equal(await isPortFree(port), true);
  for (const host of ['127.0.0.1', '0.0.0.0', undefined]) {
    const server = await listen(t, port, host);
    assert.equal(await isPortFree(port), false, `taken on ${host ?? 'every address'}`);
    await closed(server);
    assert.equal(await isPortFree(port), true, 'and free again');
  }
});

// ---- starting and stopping -----------------------------------------------------------------------------

test(
  'the command runs through the shell, in the contact’s folder, with its port in the environment',
  opts,
  async (t) => {
    const { runs, store, events, started, printed } = setup(t);
    const command = 'echo "in=$(pwd -P) port=$PORT ours=$BUDDYLIST_PORT" && sleep 30';
    const { who, run } = await started(command);

    assert.equal(run.command, command);
    assert.equal(run.ended, null);
    assert.equal(run.movedFrom, null);
    assert.ok(run.port >= PORTS.first && run.port <= PORTS.last, `port ${run.port} is one of ours`);
    assert.ok(Math.abs(run.startedAt - Date.now()) < 5000);
    assert.deepEqual(events[0], { contactId: who.id, type: 'started', run });
    assert.equal(store.getContact(who.id).port, run.port, 'the port is the contact’s from now on');

    await until(() => printed(run).includes('\n'), 'its first line');
    assert.equal(printed(run), `in=${who.cwd} port=${run.port} ours=${run.port}\n`);

    assert.equal(await runs.stop(who.id), undefined);
    assert.deepEqual(events.at(-1), {
      contactId: who.id,
      type: 'ended',
      id: run.id,
      code: null,
      signal: 'SIGTERM',
      stopped: true,
    });
    assert.equal(showing(runs, who.id), null);
  }
);

test('what the user’s environment has is there too, and PATH with it', opts, async (t) => {
  const { started, printed, ended } = setup(t, { env: { PATH: process.env.PATH, FROM_THE_SHELL: 'yes', PORT: '1' } });
  const { run } = await started('echo "$FROM_THE_SHELL $PORT"; command -v sh');
  await ended(run);
  assert.match(printed(run), new RegExp(`^yes ${run.port}\\n/.*sh\\n$`), 'and the port is the contact’s, not theirs');
});

test('a command that exits at once with an error says so, with what it printed', opts, async (t) => {
  const { runs, events, started, printed, ended } = setup(t);
  const { who, run } = await started('echo "no such script" >&2; exit 3');
  assert.deepEqual(await ended(run), {
    contactId: who.id,
    type: 'ended',
    id: run.id,
    code: 3,
    signal: null,
    stopped: false,
  });
  assert.equal(printed(run), 'no such script\n');
  assert.deepEqual(
    events.map((event) => event.type),
    ['started', 'output', 'ended'],
    'the last of its output is told before its end'
  );
  assert.equal(showing(runs, who.id), null);
});

test('a command the shell does not know ends like any other that failed', opts, async (t) => {
  const { started, printed, ended } = setup(t);
  const { run } = await started('no-such-program-anywhere --port $PORT');
  assert.equal((await ended(run)).code, 127);
  assert.match(printed(run), /no-such-program-anywhere/);
});

test('stopping takes everything the command started with it', opts, async (t) => {
  const { runs, started, pidOf, ended } = setup(t);
  const { who, run } = await started('sleep 30 & echo "shell=$$ child=$!"; wait');
  const [shell, child] = [await pidOf(run, 'shell'), await pidOf(run, 'child')];
  assert.ok(alive(shell) && alive(child));

  await runs.stop(who.id);
  await gone(shell, child);
  assert.equal((await ended(run)).stopped, true);
});

test('a child that ignores a polite stop is killed, also when the shell itself went quietly', opts, async (t) => {
  const { runs, started, pidOf } = setup(t);
  const { who, run } = await started('(trap "" TERM; exec sleep 30) & echo "shell=$$ child=$!"; wait');
  const [shell, child] = [await pidOf(run, 'shell'), await pidOf(run, 'child')];
  const asked = Date.now();
  await runs.stop(who.id);
  assert.ok(Date.now() - asked >= GRACE_MS - 20, 'it was given its time first');
  await gone(shell, child);
});

test('a command that ignores a polite stop altogether is killed after a while', opts, async (t) => {
  const { runs, started, printed, ended } = setup(t);
  const { who, run } = await started('trap "" TERM; echo ready; sleep 30; echo "still here"');
  await until(() => printed(run).includes('ready'), 'the trap to be set');
  const asked = Date.now();
  await runs.stop(who.id);
  const took = Date.now() - asked;
  assert.ok(took >= GRACE_MS - 20 && took < GRACE_MS + 3000, `killed after its time was up (${took} ms)`);
  const end = await ended(run);
  assert.equal(end.signal, 'SIGKILL');
  assert.equal(end.stopped, true);
  assert.doesNotMatch(printed(run), /still here/);
});

test('a command that ends by itself takes along what it left running in the background', opts, async (t) => {
  const { runs, started, pidOf, ended } = setup(t);
  const { who, run } = await started('sleep 30 & echo "child=$!"');
  const child = await pidOf(run, 'child');
  const end = await ended(run);
  assert.deepEqual([end.code, end.stopped], [0, false]);
  await gone(child);
  assert.equal(showing(runs, who.id), null);
});

test('Run pressed twice starts one command', opts, async (t) => {
  const { runs, events, contact, printed } = setup(t);
  const who = contact();
  const marks = path.join(who.cwd, 'started.txt');
  await runs.setCommand(who.id, `echo started >> "${marks}"; echo up; sleep 30`);
  const [first, second] = await Promise.all([runs.start(who.id), runs.start(who.id)]);
  assert.deepEqual(second, first);
  await until(() => printed(first).includes('up'), 'it to be up');
  const third = await runs.start(who.id);
  assert.equal(third.id, first.id, 'and again while it runs: still the same one');
  assert.equal(third.output, 'up\n', 'with what it has printed since');
  assert.equal(events.filter((event) => event.type === 'started').length, 1);
  assert.equal(fs.readFileSync(marks, 'utf8'), 'started\n');
});

test('Stop pressed when nothing runs does nothing', opts, async (t) => {
  const { runs, events, contact } = setup(t);
  const who = contact();
  assert.equal(await runs.stop(who.id), undefined);
  assert.equal(await runs.stop('no-such-contact'), undefined);
  assert.deepEqual(events, []);
});

test('Stop pressed twice ends it once', opts, async (t) => {
  const { runs, events, started } = setup(t);
  const { who } = await started('sleep 30');
  await Promise.all([runs.stop(who.id), runs.stop(who.id)]);
  await runs.stop(who.id);
  assert.equal(events.filter((event) => event.type === 'ended').length, 1);
});

test('Run pressed while the last one is still on its way out waits for it, and gets its port', opts, async (t) => {
  const { runs, events, started, printed } = setup(t);
  const { who, run } = await started('trap "" TERM; echo ready; sleep 30');
  await until(() => printed(run).includes('ready'), 'the trap to be set');
  const stopping = runs.stop(who.id);
  const next = await runs.start(who.id);
  await stopping;
  assert.notEqual(next.id, run.id);
  assert.deepEqual([next.port, next.movedFrom], [run.port, null], 'the port was its own, not taken by something else');
  assert.deepEqual(
    events.filter((event) => event.type !== 'output').map((event) => [event.type, event.id ?? event.run.id]),
    [
      ['started', run.id],
      ['ended', run.id],
      ['started', next.id],
    ]
  );
});

test('stopping one that is still being started stops it all the same', opts, async (t) => {
  const { runs, events, contact } = setup(t);
  const who = contact();
  await runs.setCommand(who.id, 'echo "shell=$$"; sleep 30');
  const starting = runs.start(who.id);
  await runs.stop(who.id);
  const run = await starting;
  assert.equal(showing(runs, who.id), null);
  assert.deepEqual(
    events.filter((event) => event.type !== 'output').map((event) => event.type),
    ['started', 'ended']
  );
  assert.equal(events.at(-1).id, run.id);
});

// ---- what can't be started ----------------------------------------------------------------------------

test('without a run command, or without the contact, there is nothing to start', opts, async (t) => {
  const { runs, events, contact } = setup(t);
  const who = contact(path.join(tmp(), 'shop'));
  fs.mkdirSync(who.cwd);
  await assert.rejects(runs.start(who.id), /^Error: shop has no run command yet\.$/);
  await assert.rejects(runs.start('no-such-contact'), /^Error: This contact no longer exists\.$/);
  await assert.rejects(runs.command('no-such-contact'), /This contact no longer exists\./);
  await assert.rejects(runs.setCommand('no-such-contact', 'make'), /This contact no longer exists\./);
  assert.deepEqual(events, []);
  assert.equal(showing(runs, who.id), null);
});

test('a contact whose folder is gone can’t run anything, and says why', opts, async (t) => {
  const { runs, events, contact } = setup(t);
  const who = contact(path.join(tmp(), 'shop'));
  fs.mkdirSync(who.cwd);
  await runs.setCommand(who.id, 'sleep 30');
  fs.rmdirSync(who.cwd);
  await assert.rejects(runs.start(who.id), /The folder .*shop isn’t there any more\./);
  assert.deepEqual(events, []);
  assert.equal(showing(runs, who.id), null);
});

test('a shell that isn’t there says so, and leaves nothing behind', opts, async (t) => {
  const { runs, events, contact } = setup(t, { shell: '/no/such/shell' });
  const who = contact();
  await runs.setCommand(who.id, 'sleep 30');
  await assert.rejects(runs.start(who.id), /^Error: The command could not be started: .*\.$/);
  assert.deepEqual(events, []);
  assert.equal(showing(runs, who.id), null);
  const quit = { preventDefault: () => assert.fail('nothing runs, so nothing holds the quit back') };
  runs.holdQuit(quit, () => {});
});

// ---- the contact goes, or its folder ----------------------------------------------------------------

test('a contact deleted while its command runs: stopping still stops all of it', opts, async (t) => {
  const { runs, store, started, pidOf } = setup(t);
  const { who, run } = await started('sleep 30 & echo "shell=$$ child=$!"; wait');
  const [shell, child] = [await pidOf(run, 'shell'), await pidOf(run, 'child')];
  store.removeContact(who.id);
  await runs.stop(who.id);
  await gone(shell, child);
  assert.equal(showing(runs, who.id), null);
});

test('a command that ends after its contact was deleted ends quietly', opts, async (t) => {
  const { runs, store, started, ended } = setup(t);
  const { who, run } = await started('sleep 0.3; exit 1');
  store.removeContact(who.id);
  assert.equal((await ended(run)).code, 1);
  assert.equal(showing(runs, who.id), null);
});

test('a folder removed under a running command: it can still be stopped', opts, async (t) => {
  const { runs, started, pidOf } = setup(t);
  const { who, run } = await started('echo "shell=$$"; sleep 30');
  const shell = await pidOf(run, 'shell');
  fs.rmSync(who.cwd, { recursive: true });
  await runs.stop(who.id);
  await gone(shell);
});

// ---- one command for a project, one port for a contact -----------------------------------------------

const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();

test(
  'two contacts in two worktrees of one repository share the command, and each has its own port',
  { skip: !POSIX || !HAS_GIT },
  async (t) => {
    const { runs, store, contact, printed } = setup(t);
    const dir = path.join(tmp(), 'shop');
    fs.mkdirSync(dir);
    git(dir, 'init', '--quiet', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'first');
    const copy = path.join(tmp(), 'fix-login');
    git(dir, 'worktree', 'add', '--quiet', '-b', 'fix-login', copy);
    const [main, other] = [contact(dir, 'Claude'), contact(copy, 'Codex')];

    const command = 'echo "in=$(pwd -P) port=$PORT"; sleep 30';
    assert.deepEqual(await runs.setCommand(main.id, command), { project: 'shop', command });
    assert.deepEqual(await runs.command(other.id), { project: 'shop', command, suggestion: '' });
    assert.equal(Object.keys(store.projects).length, 1, 'kept once, for the repository');

    const [first, second] = await Promise.all([runs.start(main.id), runs.start(other.id)]);
    assert.notEqual(first.port, second.port);
    await until(() => printed(first).includes('\n') && printed(second).includes('\n'), 'both to be up');
    assert.equal(printed(first), `in=${dir} port=${first.port}\n`);
    assert.equal(printed(second), `in=${copy} port=${second.port}\n`);

    // Changed from the other worktree, it is changed for both.
    await runs.setCommand(other.id, 'make dev');
    assert.equal((await runs.command(main.id)).command, 'make dev');
    await runs.stopAll();
  }
);

test('outside a repository the command belongs to the folder: shared in it, unknown next to it', opts, async (t) => {
  const { runs, contact } = setup(t);
  const root = tmp();
  const [notes, blog] = ['notes', 'blog'].map((name) => path.join(root, name));
  fs.mkdirSync(notes);
  fs.mkdirSync(blog);
  const [one, two, elsewhere] = [contact(notes), contact(notes), contact(blog)];
  await runs.setCommand(one.id, 'make watch');
  assert.deepEqual(await runs.command(two.id), { project: 'notes', command: 'make watch', suggestion: '' });
  assert.deepEqual(await runs.command(elsewhere.id), { project: 'blog', command: '', suggestion: '' });
  await assert.rejects(runs.start(elsewhere.id), /blog has no run command yet\./);
});

test('the dialog is offered what the folder suggests, and an empty answer is not kept', opts, async (t) => {
  const { runs, store, contact } = setup(t);
  const who = contact();
  fs.writeFileSync(path.join(who.cwd, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev' } }));
  fs.writeFileSync(path.join(who.cwd, 'pnpm-lock.yaml'), '');
  const project = path.basename(who.cwd);
  assert.deepEqual(await runs.command(who.id), { project, command: '', suggestion: 'pnpm dev' });

  for (const nothing of ['', '   ', '\n']) {
    await assert.rejects(runs.setCommand(who.id, nothing), /^Error: Type the command that starts this project\.$/);
  }
  assert.deepEqual(store.projects, {});

  assert.deepEqual(await runs.setCommand(who.id, '  pnpm dev  '), { project, command: 'pnpm dev' });
  assert.deepEqual(await runs.command(who.id), { project, command: 'pnpm dev', suggestion: 'pnpm dev' });
  await assert.rejects(runs.setCommand(who.id, ' '), /Type the command/);
  assert.equal((await runs.command(who.id)).command, 'pnpm dev', 'what was there stays');
});

test(
  'a run command of a few lines is kept line for line, and is one script: a folder and a variable carry on',
  opts,
  async (t) => {
    const { runs, contact, printed, ended } = setup(t);
    const who = contact();
    fs.mkdirSync(path.join(who.cwd, 'web'));
    const typed = '\r\ncd web\r\nGREETING=hello\r\n\r\necho "$GREETING from $(basename "$PWD") on $PORT"\r\n';
    const command = 'cd web\nGREETING=hello\n\necho "$GREETING from $(basename "$PWD") on $PORT"';
    assert.deepEqual(await runs.setCommand(who.id, typed), { project: path.basename(who.cwd), command });
    const run = await runs.start(who.id);
    assert.equal(run.command, command);
    await ended(run);
    assert.equal(printed(run), `hello from web on ${run.port}\n`);
  }
);

test('a line of the run command that fails stops the ones after it, and the run failed', opts, async (t) => {
  const { started, printed, ended } = setup(t);
  const { run } = await started('echo installing\n(exit 3)\necho serving');
  assert.equal((await ended(run)).code, 3);
  assert.equal(printed(run), 'installing\n');
});

test('a run command of one line goes on past a command that fails, as it always has', opts, async (t) => {
  const { started, printed, ended } = setup(t);
  const { run } = await started('(exit 3); echo serving');
  assert.equal((await ended(run)).code, 0);
  assert.equal(printed(run), 'serving\n');
});

test('a setup script of a few lines goes on past a line that fails, as it always has', opts, async (t) => {
  const { runs, store, contact, printed, ended } = setup(t);
  const who = contact();
  store.updateProject((await describeProject(who.cwd)).key, { setup: '(exit 3)\necho set up' });
  const run = await runs.setup(who.id);
  assert.equal((await ended(run)).code, 0);
  assert.equal(printed(run), 'set up\n');
});

test('a script file picked in the contact’s folder is run from there, on the contact’s port', opts, async (t) => {
  const { runs, contact, printed, ended } = setup(t);
  const who = contact();
  // Not marked as a program: it is handed to the one its first line names.
  const file = path.join(who.cwd, 'scripts', 'start.sh');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, '#!/bin/sh\necho "serving $(basename "$PWD") on $PORT"\n');
  const command = await runs.fileCommand(who.id, file);
  assert.equal(command, '/bin/sh scripts/start.sh');
  // Nothing is kept until the dialog is answered.
  assert.equal((await runs.command(who.id)).command, '');

  await runs.setCommand(who.id, command);
  const run = await runs.start(who.id);
  await ended(run);
  assert.equal(printed(run), `serving ${path.basename(who.cwd)} on ${run.port}\n`);
});

test('a script file outside the contact’s folder can’t be its run command, and says why', opts, async (t) => {
  const { runs, contact } = setup(t);
  const who = contact();
  const elsewhere = path.join(tmp(), 'start.sh');
  fs.writeFileSync(elsewhere, 'echo hi\n');
  await assert.rejects(
    runs.fileCommand(who.id, elsewhere),
    new RegExp(
      `^Error: Choose a file in .*${path.basename(who.cwd)}: every contact working on .* runs it from its own folder\\.$`
    )
  );
  await assert.rejects(runs.fileCommand('no-such-contact', elsewhere), /This contact no longer exists\./);
});

test('a contact keeps its port from one run to the next, and when the app starts again', opts, async (t) => {
  const { dir, runs, started } = setup(t);
  const { who, run } = await started('sleep 30');
  await runs.stop(who.id);
  const again = await runs.start(who.id);
  assert.deepEqual([again.port, again.movedFrom], [run.port, null]);
  assert.notEqual(again.id, run.id);
  await runs.stop(who.id);

  const restarted = new Runs({
    store: new Store(dir, STORE_DEFAULTS),
    send: () => true,
    shell: '/bin/sh',
    graceMs: GRACE_MS,
    ports: PORTS,
  });
  t.after(() => restarted.killAll());
  assert.equal((await restarted.start(who.id)).port, run.port);
  await restarted.stop(who.id);
});

test('a kept port that something else has taken is given up for another, and the run says so', opts, async (t) => {
  const { runs, store, started } = setup(t);
  const { who, run } = await started('sleep 30');
  await runs.stop(who.id);

  const squatter = await listen(t, run.port, '127.0.0.1');
  const moved = await runs.start(who.id);
  assert.notEqual(moved.port, run.port);
  assert.equal(moved.movedFrom, run.port);
  assert.equal(store.getContact(who.id).port, moved.port, 'the new one is its port from now on');
  await runs.stop(who.id);

  // It does not jump back once the old one is free again: bookmarks follow the newest.
  await closed(squatter);
  const after = await runs.start(who.id);
  assert.deepEqual([after.port, after.movedFrom], [moved.port, null]);
  await runs.stop(who.id);
});

test('many contacts asking at once each get a port of their own', opts, async (t) => {
  const { runs, store, contact, printed } = setup(t);
  const everyone = Array.from({ length: 12 }, () => contact());
  await Promise.all(everyone.map((who) => runs.setCommand(who.id, 'echo "shell=$$ port=$PORT"; sleep 30')));
  const all = await Promise.all(everyone.map((who) => runs.start(who.id)));

  const ports = all.map((run) => run.port);
  assert.equal(new Set(ports).size, everyone.length, `no port twice in ${ports}`);
  for (const port of ports) assert.equal((port - PORTS.first) % PORTS.step, 0, 'each with room after it');
  assert.deepEqual(
    everyone.map((who) => store.getContact(who.id).port),
    ports
  );
  await until(() => all.every((run) => /port=\d+\n/.test(printed(run))), 'all of them to be up');
  for (const run of all) assert.match(printed(run), new RegExp(`port=${run.port}\\n`));

  const shells = all.map((run) => Number(printed(run).match(/shell=(\d+)/)[1]));
  await runs.stopAll();
  await gone(...shells);
});

test('a port another contact holds is not handed out, also while that contact runs nothing', opts, async (t) => {
  const { runs, store, contact } = setup(t);
  const [holder, who] = [contact(), contact()];
  store.updateContact(holder.id, { port: PORTS.first });
  await runs.setCommand(who.id, 'sleep 30');
  const run = await runs.start(who.id);
  assert.notEqual(run.port, PORTS.first);
  assert.equal(run.movedFrom, null);
  await runs.stop(who.id);

  // Once the holder is deleted, its port is anyone's.
  store.removeContact(holder.id);
  const next = contact();
  await runs.setCommand(next.id, 'sleep 30');
  assert.equal((await runs.start(next.id)).port, PORTS.first);
});

test('a port in the file that can’t be one is replaced without a word', opts, async (t) => {
  for (const nonsense of [80, 70000, 'abc', 4100.5, null]) {
    const { runs, store, contact } = setup(t);
    const who = contact();
    store.updateContact(who.id, { port: nonsense });
    await runs.setCommand(who.id, 'sleep 30');
    const run = await runs.start(who.id);
    assert.ok(run.port >= PORTS.first && run.port <= PORTS.last);
    assert.equal(run.movedFrom, null);
    await runs.stop(who.id);
  }
});

test('when every port is taken, the run says so instead of starting', opts, async (t) => {
  const only = { first: PORTS.last + 5, last: PORTS.last + 5, step: 10 };
  const { runs, events, contact } = setup(t, { ports: only });
  await listen(t, only.first, '127.0.0.1');
  const who = contact();
  await runs.setCommand(who.id, 'sleep 30');
  await assert.rejects(runs.start(who.id), /^Error: There is no free port left between \d+ and \d+\.$/);
  assert.deepEqual(events, []);
});

// ---- what it prints ---------------------------------------------------------------------------------------

test('both of its outputs are shown, in plain text', opts, async (t) => {
  const { started, printed, ended } = setup(t);
  const { run } = await started(
    "printf '\\033[32mgreen\\033[0m \\033]0;a title\\007plain\\r\\n'; sleep 0.2; echo 'and an error' >&2"
  );
  await ended(run);
  assert.equal(printed(run), 'green plain\nand an error\n');
});

test('half a line is shown without waiting for the rest of it', opts, async (t) => {
  const { events, started, printed } = setup(t);
  const { run } = await started("printf 'Password for the dev database: '; sleep 30");
  await until(() => printed(run), 'the prompt');
  assert.equal(events.find((event) => event.type === 'output').text, 'Password for the dev database: ');
});

test('of a very chatty command only the end is kept, and its window is not flooded', opts, async (t) => {
  const { runs, events, started } = setup(t);
  const line = 'a line that a chatty dev server prints over and over again';
  const { who, run } = await started(`yes "${line}" | head -n 60000; echo "the last line"; sleep 30`);
  const { output } = await until(() => {
    const now = showing(runs, who.id);
    return now.output.endsWith('the last line\n') && now;
  }, 'the last line');

  assert.ok(60000 * line.length > 10 * OUTPUT_KEPT, 'it printed many times what is kept');
  assert.ok(output.length <= OUTPUT_KEPT + 100, `${output.length} characters kept`);
  assert.match(output, /^… earlier output is not kept\n/);
  const heard = (event) => event.type === 'output' && event.id === run.id && event.text.endsWith('the last line\n');
  await until(() => events.some(heard), 'its window to hear the last line');
  const all = events.filter((event) => event.type === 'output');
  assert.ok(all.length < 200, `${all.length} messages for 60000 lines`);
  for (const event of all) assert.ok(event.text.length <= OUTPUT_KEPT + 100);
});

// ---- a window that opens later ---------------------------------------------------------------------------

test('a window opened while the command runs is shown it, with the output so far', opts, async (t) => {
  const { runs, world, started } = setup(t);
  world.watching = false;
  const { who, run } = await started('echo "ready on $PORT"; sleep 30');
  const now = await until(() => {
    const state = showing(runs, who.id);
    return state.output && state;
  }, 'its output');
  assert.deepEqual(now, { ...run, output: `ready on ${run.port}\n` });
  assert.deepEqual(showing(runs, who.id), now, 'and again, as often as it is opened');
});

test('a command that ended while no window was open is told about once, when one opens', opts, async (t) => {
  const { runs, world, events, started } = setup(t);
  world.watching = false;
  const { who, run } = await started('echo "port $PORT is all I say"; exit 2');
  const missed = await until(() => {
    const state = showing(runs, who.id);
    return state?.ended && state;
  }, 'it to end');
  assert.deepEqual(missed, {
    ...run,
    output: `port ${run.port} is all I say\n`,
    ended: { code: 2, signal: null, stopped: false },
  });
  assert.equal(showing(runs, who.id), null, 'once is enough');
  assert.deepEqual(events, []);
});

test('a window that can’t be told counts as closed, and nothing is left hanging', opts, async (t) => {
  const store = new Store(tmp(), STORE_DEFAULTS);
  const runs = new Runs({
    store,
    send: () => {
      throw new Error('Object has been destroyed');
    },
    shell: '/bin/sh',
    graceMs: GRACE_MS,
    ports: PORTS,
  });
  t.after(() => runs.killAll());
  const who = store.addContact({
    provider: 'claude',
    name: 'Claude',
    cwd: tmp(),
    model: '',
    permissionMode: 'default',
  });
  await runs.setCommand(who.id, 'echo "said to nobody"; sleep 0.3; exit 4');
  const run = await runs.start(who.id);
  const missed = await until(() => {
    const state = showing(runs, who.id);
    return state?.ended && state;
  }, 'it to end');
  assert.deepEqual(missed, { ...run, output: 'said to nobody\n', ended: { code: 4, signal: null, stopped: false } });

  await runs.setCommand(who.id, 'sleep 30');
  await runs.start(who.id);
  await runs.stop(who.id);
  assert.equal(showing(runs, who.id), null);
});

test('one that was stopped while no window was open is not brought up later', opts, async (t) => {
  const { runs, world, started } = setup(t);
  world.watching = false;
  const { who } = await started('sleep 30');
  // As when the contact's folder is changed from the contact list.
  await runs.stop(who.id);
  assert.equal(world.unheard.at(-1).stopped, true);
  assert.equal(showing(runs, who.id), null);
});

test('the next run takes the place of one that was missed', opts, async (t) => {
  const { runs, world, started } = setup(t);
  world.watching = false;
  const { who, run } = await started('exit 2');
  await until(() => world.unheard.some((event) => event.type === 'ended'), 'it to end unseen');
  world.watching = true;
  await runs.setCommand(who.id, 'sleep 30');
  const next = await runs.start(who.id);
  assert.notEqual(next.id, run.id);
  assert.equal(showing(runs, who.id).id, next.id);
  await runs.stop(who.id);
  assert.equal(showing(runs, who.id), null);
});

// ---- the app quits ----------------------------------------------------------------------------------------

test('quitting with three commands running waits until all of them are gone', opts, async (t) => {
  const { runs, contact, printed } = setup(t);
  const commands = [
    'sleep 30 & echo "shell=$$ child=$!"; wait',
    'trap "" TERM; sleep 30 & echo "shell=$$ child=$!"; wait',
    '(trap "" TERM; exec sleep 30) & echo "shell=$$ child=$!"; wait',
  ];
  const all = [];
  for (const command of commands) {
    const who = contact();
    await runs.setCommand(who.id, command);
    all.push(await runs.start(who.id));
  }
  await until(() => all.every((run) => /child=\d+\n/.test(printed(run))), 'all three to be up');
  const pids = all.flatMap((run) => [...printed(run).matchAll(/=(\d+)/g)].map((match) => Number(match[1])));
  assert.equal(pids.filter(alive).length, 6);

  let prevented = 0;
  const quit = new Promise((resolve) => {
    runs.holdQuit({ preventDefault: () => (prevented += 1) }, resolve);
  });
  assert.equal(prevented, 1, 'the quit is held back');
  await quit;
  // Nothing is left when the app is let go.
  await gone(...pids);

  // Asked again, as the app does once they are gone, nothing holds it back.
  runs.holdQuit({ preventDefault: () => assert.fail('nothing runs any more') }, () => assert.fail('no need to ask'));
});

test('quitting while a command is still being started stops that one too', opts, async (t) => {
  const { runs, contact, events } = setup(t);
  const who = contact();
  await runs.setCommand(who.id, 'sleep 30');
  const starting = runs.start(who.id);
  let prevented = 0;
  await new Promise((resolve) => {
    runs.holdQuit({ preventDefault: () => (prevented += 1) }, resolve);
  });
  assert.equal(prevented, 1);
  await starting;
  assert.equal(showing(runs, who.id), null);
  assert.equal(events.at(-1).type, 'ended');
});

test('as a last resort everything is killed at once, without waiting', opts, async (t) => {
  const { runs, started, pidOf, ended } = setup(t);
  const { run } = await started('trap "" TERM; (trap "" TERM; exec sleep 30) & echo "shell=$$ child=$!"; wait');
  const [shell, child] = [await pidOf(run, 'shell'), await pidOf(run, 'child')];
  assert.equal(runs.killAll(), undefined);
  await gone(shell, child);
  assert.equal((await ended(run)).signal, 'SIGKILL');
});

// ---- a project with several scripts ----------------------------------------------------------------

/** Keeps `settings` about the project of a contact's folder, which is outside any repository here. */
const setUp = (store, who, settings) => store.updateProject(`dir:${who.cwd}`, settings);
const TWO = [
  { id: 'dev', name: 'Dev server', command: 'echo dev; sleep 30' },
  { id: 'tests', name: 'Tests', command: 'echo tests; sleep 30' },
];

test('what Run can start is the project’s scripts, the button’s own first', async (t) => {
  const { runs, store, contact } = setup(t);
  const who = contact();
  assert.deepEqual((await runs.scripts(who.id)).scripts, []);
  setUp(store, who, { scripts: TWO });
  const known = await runs.scripts(who.id);
  assert.deepEqual(known, {
    project: path.basename(who.cwd),
    scripts: TWO,
    suggestion: '',
    // The tabs beside a conversation also ask for the script that sets a worktree up.
    setup: '',
    setupSuggestion: '',
  });
  setUp(store, who, { setup: 'pnpm install' });
  assert.equal((await runs.scripts(who.id)).setup, 'pnpm install');
  // The run command, as the dialog asks for it, is the first of them.
  assert.equal((await runs.command(who.id)).command, TWO[0].command);
  await assert.rejects(runs.scripts('nobody'), /no longer exists/);
});

test('changing the run command changes the first script, and leaves the others as they are', async (t) => {
  const { runs, store, contact } = setup(t);
  const who = contact();
  setUp(store, who, { scripts: TWO, setup: 'make deps' });
  await runs.setCommand(who.id, 'pnpm dev');
  assert.deepEqual(store.getProject(`dir:${who.cwd}`), {
    scripts: [{ ...TWO[0], command: 'pnpm dev' }, TWO[1]],
    setup: 'make deps',
  });
});

test('a project’s other scripts run next to the button’s own, and each is stopped by itself', opts, async (t) => {
  const { runs, store, contact, printed, ended } = setup(t);
  const who = contact();
  setUp(store, who, { scripts: TWO });
  const dev = await runs.start(who.id);
  const tests = await runs.start(who.id, 'tests');
  assert.deepEqual([dev.kind, dev.script, dev.name], ['run', 'dev', 'Dev server']);
  assert.deepEqual([tests.kind, tests.script, tests.name], ['run', 'tests', 'Tests']);
  assert.notEqual(tests.id, dev.id);
  assert.equal(tests.port, dev.port, 'a contact has one port, whatever it runs');
  await until(() => printed(dev) && printed(tests), 'both to print');
  assert.deepEqual([printed(dev), printed(tests)], ['dev\n', 'tests\n']);
  assert.deepEqual(
    runs.state(who.id).map((run) => run.id),
    [dev.id, tests.id],
    'a window that opens is shown both, the older first'
  );

  // Asked for again, by its name or as the button's own, the one that runs is the answer.
  assert.equal((await runs.start(who.id, 'dev')).id, dev.id);
  assert.equal((await runs.start(who.id)).id, dev.id);
  assert.equal((await runs.start(who.id, 'tests')).id, tests.id);

  await runs.stop(who.id, 'tests');
  assert.equal((await ended(tests)).stopped, true);
  assert.deepEqual(
    runs.state(who.id).map((run) => run.id),
    [dev.id]
  );
  // Without a name, everything the contact runs is stopped.
  await runs.start(who.id, 'tests');
  await runs.stop(who.id);
  assert.deepEqual(runs.state(who.id), []);
});

test('two scripts started at once are both started, each once', opts, async (t) => {
  const { runs, store, contact, events } = setup(t);
  const who = contact();
  setUp(store, who, { scripts: TWO });
  const all = await Promise.all([
    runs.start(who.id),
    runs.start(who.id, 'tests'),
    runs.start(who.id, 'dev'),
    runs.start(who.id, 'tests'),
  ]);
  assert.deepEqual(
    all.map((run) => run.script),
    ['dev', 'tests', 'dev', 'tests']
  );
  assert.equal(new Set(all.map((run) => run.id)).size, 2);
  assert.equal(events.filter((event) => event.type === 'started').length, 2);
});

test('a script that is no longer the project’s can’t be started', async (t) => {
  const { runs, store, contact } = setup(t);
  const who = contact();
  setUp(store, who, { scripts: TWO });
  await assert.rejects(runs.start(who.id, 'gone'), new RegExp(`${path.basename(who.cwd)} has no such script any more`));
  assert.deepEqual(runs.state(who.id), []);
});

test('a command is started with its project’s variables, and its port stays the contact’s', opts, async (t) => {
  const asked = [];
  const { started, printed } = setup(t, {
    environment: (project, cwd) => {
      asked.push([project.key, cwd]);
      // A project that calls one of its own variables PORT does not get to move the contact.
      return { GREETING: 'hello from settings', PORT: '1' };
    },
  });
  const { who, run } = await started('echo "$GREETING on $PORT"');
  await until(() => printed(run).includes('\n'), 'its line');
  assert.equal(printed(run), `hello from settings on ${run.port}\n`);
  assert.deepEqual(asked, [[`dir:${who.cwd}`, who.cwd]]);
});

test('a run says where it is looked at: its port, or the pages its project names', opts, async (t) => {
  const { runs, store, started } = setup(t);
  const { who, run } = await started('sleep 30');
  assert.deepEqual(run.urls, [{ name: '', url: `http://localhost:${run.port}` }]);
  await runs.stop(who.id);
  setUp(store, who, {
    previewUrls: [
      { name: '', url: 'https://localhost:$PORT' },
      { name: 'API', url: 'http://localhost:$((PORT + 1))/docs' },
    ],
  });
  assert.deepEqual((await runs.start(who.id)).urls, [
    { name: '', url: `https://localhost:${run.port}` },
    { name: 'API', url: `http://localhost:${run.port + 1}/docs` },
  ]);
});

// ---- the script that sets a new worktree up ----------------------------------------------------------

test('a project’s setup script is run like any other, with no page to look at', opts, async (t) => {
  const { runs, store, contact, events, printed, ended } = setup(t);
  const who = contact();
  setUp(store, who, { setup: 'echo "installing in $(pwd -P) for $PORT"', scripts: TWO });
  const run = await runs.setup(who.id);
  assert.deepEqual([run.kind, run.script, run.name, run.urls], ['setup', 'setup', 'Setup', []]);
  assert.deepEqual(events[0], { contactId: who.id, type: 'started', run });
  assert.deepEqual([(await ended(run)).code, printed(run)], [0, `installing in ${who.cwd} for ${run.port}\n`]);
  assert.equal(store.getContact(who.id).port, run.port, 'the port it was told is the contact’s from then on');
});

test('the setup script is run again by its name, as the Run setup button does', opts, async (t) => {
  const { runs, store, contact, ended } = setup(t);
  const who = contact();
  setUp(store, who, { setup: 'echo again' });
  const first = await runs.start(who.id, 'setup');
  assert.equal(first.kind, 'setup');
  await ended(first);
  const second = await runs.start(who.id, 'setup');
  assert.notEqual(second.id, first.id);
  assert.equal((await ended(second)).code, 0);
});

test('a pull request’s worktree is not set up by itself: its setup script waits for the user', opts, async (t) => {
  const { runs, store, contact, events, ended } = setup(t);
  const who = contact();
  store.updateContact(who.id, { setupWaits: true });
  setUp(store, who, { setup: 'echo installing' });
  // What contactAdd asks for each new worktree: the pull request's code is not run.
  assert.equal(await runs.setup(who.id), null);
  assert.deepEqual(events, []);
  assert.equal(store.getContact(who.id).port, undefined, 'and the contact is given no port for it');
  assert.equal(store.getContact(who.id).setupWaits, true);
  // Run setup, pressed by the user, runs it. From then on it waits no more.
  const run = await runs.start(who.id, 'setup');
  assert.equal(run.kind, 'setup');
  assert.equal((await ended(run)).code, 0);
  assert.equal(store.getContact(who.id).setupWaits, null);
});

test('a setup script that could not be started still waits for the user', opts, async (t) => {
  const { runs, store, contact } = setup(t, { shell: '/no/such/shell' });
  const who = contact();
  store.updateContact(who.id, { setupWaits: true });
  setUp(store, who, { setup: 'echo installing' });
  await assert.rejects(runs.start(who.id, 'setup'), /^Error: The command could not be started: /);
  assert.equal(store.getContact(who.id).setupWaits, true);
});

test('a project without a setup script has nothing to set up', async (t) => {
  const { runs, store, contact, events } = setup(t);
  const who = contact();
  assert.equal(await runs.setup(who.id), null);
  setUp(store, who, { scripts: TWO });
  assert.equal(await runs.setup(who.id), null);
  assert.deepEqual(events, []);
  assert.equal(store.getContact(who.id).port, undefined, 'and the contact is given no port for it');
});

test('a setup script that failed while no window was open is told when one opens', opts, async (t) => {
  const { runs, store, contact, world } = setup(t);
  const who = contact();
  setUp(store, who, { setup: 'echo "no such package"; exit 7' });
  world.watching = false;
  const run = await runs.setup(who.id);
  // While it runs a window is shown it as it is. Once it has ended by itself, that is what is told.
  const missed = await until(() => runs.state(who.id).find((shown) => shown.ended), 'it to end');
  assert.deepEqual(missed, {
    ...run,
    output: 'no such package\n',
    ended: { code: 7, signal: null, stopped: false },
  });
  assert.deepEqual(runs.state(who.id), [], 'once is enough');
});

test('Run can be pressed while the setup script is still at work, and stopping ends both', opts, async (t) => {
  const { runs, store, contact } = setup(t);
  const who = contact();
  setUp(store, who, { setup: 'sleep 30', scripts: TWO });
  const [first, dev] = [await runs.setup(who.id), await runs.start(who.id)];
  assert.deepEqual(
    runs.state(who.id).map((run) => run.kind),
    ['setup', 'run']
  );
  assert.notEqual(first.id, dev.id);
  await runs.stop(who.id);
  assert.deepEqual(runs.state(who.id), []);
});

// ---- a script that is only run to its end: the one that cleans a worktree up -------------------------

test('a script run to its end says how it went and what it printed', opts, async () => {
  const cwd = tmp();
  assert.deepEqual(
    await runToEnd('echo "in $(pwd -P) with $WORD"; exit 3', {
      cwd,
      env: { ...process.env, WORD: 'care' },
      shell: '/bin/sh',
    }),
    {
      code: 3,
      output: `in ${cwd} with care\n`,
      timedOut: false,
    }
  );
  assert.equal((await runToEnd('true', { cwd, shell: '/bin/sh' })).code, 0);
});

test('a script that takes too long is stopped, with what it left running', opts, async () => {
  const cwd = tmp();
  const result = await runToEnd('sleep 30 & echo "child=$!"; wait', { cwd, shell: '/bin/sh', timeoutMs: 300 });
  assert.deepEqual([result.code, result.timedOut], [null, true]);
  await gone(Number(result.output.match(/child=(\d+)/)[1]));
});

test('a script that can’t be started says so instead of failing', opts, async () => {
  const result = await runToEnd('echo hi', { cwd: path.join(tmp(), 'gone'), shell: '/bin/sh' });
  assert.equal(result.code, null);
  assert.equal(result.timedOut, false);
  assert.ok(result.output);
});

// ---- the shell a script runs in, on each system ---------------------------------------------------------

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const on = (platform, bash = GIT_BASH) => ({
  cwd: 'C:\\repo',
  env: { PORT: '4100' },
  shell: '/bin/zsh',
  bash,
  platform,
});

/**
 * What Git Bash reads back from a script handed over in double quotes: inside them a backslash
 * takes the next character as it is (`globify` in msys2-runtime's winsup/cygwin/dcrt0.cc). Null
 * when a quote inside would end the argument early.
 */
const readBack = (arg) => (/^"(?:[^"\\]|\\.)*"$/s.test(arg) ? arg.slice(1, -1).replace(/\\(.)/gs, '$1') : null);

test('on a Mac or Linux a script runs in the user’s shell, at the head of a process group of its own', () => {
  for (const platform of ['darwin', 'linux']) {
    const { cwd, env } = on(platform);
    assert.deepEqual(spawnArgs('pnpm dev --port $PORT', on(platform)), [
      '/bin/zsh',
      ['-c', 'pnpm dev --port $PORT'],
      { cwd, env, detached: true },
    ]);
  }
});

test('on Windows a script runs in Git Bash, with no window, quoted the way Git Bash reads it', () => {
  const { cwd, env } = on('win32');
  assert.deepEqual(spawnArgs('pnpm dev --port $PORT', on('win32')), [
    GIT_BASH,
    ['-c', '"pnpm dev --port $PORT"'],
    // Its own path has a space in it: quoted too, as Windows reads the program's name.
    { cwd, env, windowsHide: true, windowsVerbatimArguments: true, argv0: `"${GIT_BASH}"` },
  ]);
});

test('every line of a script reaches Git Bash, with its quotes and backslashes as they were written', () => {
  for (const script of [
    'pnpm install\npnpm build',
    // Without a space Node would leave it unquoted, and Git Bash would take each line for an argument.
    'make\nbin/dev',
    // Node doubles a backslash only before a quote, and Git Bash halves every pair inside quotes.
    'echo "a\\\\b" \'c\\d\'',
    'echo "say \\"hi\\""',
    'echo ends with a backslash\\',
    'vite --port $((PORT + 1)) --host 0.0.0.0',
    'for f in *.js; do\n  echo "$f"\ndone',
    '~/bin/dev',
    'echo héllo ✓',
  ]) {
    const [, [flag, arg]] = spawnArgs(script, on('win32'));
    assert.equal(flag, '-c');
    assert.equal(readBack(arg), script, JSON.stringify(script));
  }
});

test('on Windows without Git Bash a script runs in cmd.exe, as it always did', () => {
  const { cwd, env } = on('win32');
  assert.deepEqual(spawnArgs('npm run dev', on('win32', null)), [
    'npm run dev',
    [],
    { cwd, env, shell: true, windowsHide: true },
  ]);
});

test('a run command of a few lines is told to stop at the first that fails, by the shells that know how', () => {
  const few = 'pnpm install\npnpm dev';
  const stopping = (platform, more) => spawnArgs(few, { ...on(platform), stopOnError: true, ...more })[1];
  for (const shell of ['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/bin/dash', '/bin/ksh']) {
    assert.deepEqual(stopping('darwin', { shell }), ['-e', '-c', few], shell);
  }
  // A shell that may take -e for something else runs the lines as they are.
  assert.deepEqual(stopping('linux', { shell: '/usr/bin/fish' }), ['-c', few]);
  assert.deepEqual(stopping('linux', { shell: '/usr/bin/nu' }), ['-c', few]);
  assert.deepEqual(stopping('win32'), ['-e', '-c', `"${few}"`]);
  // cmd.exe knows no second line anyway.
  assert.deepEqual(stopping('win32', { bash: null }), []);
  assert.deepEqual(spawnArgs(few, on('darwin'))[1], ['-c', few]);
});
