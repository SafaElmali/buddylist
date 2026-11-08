// The Run button: starts a project's own scripts (a dev server, a test watcher)
// for one contact, in the contact's folder and on a port of its own, shows what
// they print, and makes sure nothing of them is left running. The script that
// sets up a contact's new worktree is run the same way. The agent is never
// told: this is between the user and the conversation window.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { previewLinks, projectSettings, SETUP, withRunCommand } from '../shared/project-settings.js';
import { PlainOutput, tailOf } from '../shared/run-output.js';
import { shortPath } from './conversations.js';
import { gitBash } from './git-bash.js';
import {
  cleanCommand,
  describeProject,
  scriptFileCommand,
  suggestRunCommand,
  suggestSetupCommand,
} from './run-command.js';

/** @typedef {import('./storage/store.js').Contact} Contact */

/**
 * How a run ended.
 * @typedef {Object} RunEnd
 * @property {number | null} code     its exit code; null when a signal ended it
 * @property {string | null} signal   the signal that ended it, such as "SIGKILL"
 * @property {boolean} stopped        ended because it was asked to, not by itself
 */

/**
 * A run as a conversation window is told about it.
 * @typedef {Object} RunView
 * @property {string} id
 * @property {'run' | 'setup'} kind       a script Run started, or the one that sets up the contact's worktree
 * @property {string} script             which of the project's scripts it is, by id
 * @property {string} name               what that script is called
 * @property {string} command
 * @property {import('../shared/project-settings.js').PreviewUrl[]} urls  the pages it is looked at on, the
 *   one its line links to first; none for a setup script
 * @property {number} port
 * @property {number | null} movedFrom  the contact's port until now, when something else had taken it
 * @property {number} startedAt
 * @property {string} output            the end of what it has printed so far, as plain text
 * @property {RunEnd | null} ended      null while it runs
 */

/**
 * What the window of a run's contact is sent as things happen.
 * @typedef {(
 *   { type: 'started', run: RunView } |
 *   { type: 'output', id: string, text: string } |
 *   ({ type: 'ended', id: string } & RunEnd)
 * )} RunEvent
 */

// A contact's ports start ten apart, so that a script which also uses the ones right after
// its own (PORT+1 for an API, say) has room.
const PORTS = { first: 4100, last: 9990, step: 10 };
// How long a command that was asked to stop gets before it is killed.
const GRACE_MS = 3000;
// Killed, a process is gone almost at once. This is how long that is waited for.
const KILL_WAIT_MS = 2000;
// How often a command on its way out is looked at.
const LOOK_EVERY_MS = 25;
// What a command prints reaches its window this often at most, however fast it prints.
const SEND_EVERY_MS = 100;
// How long the last of its output may take once the command itself is gone.
const LAST_WORDS_MS = 300;
const IS_WINDOWS = process.platform === 'win32';
// The shells told to stop at the first command that fails with -e: sh and the ones that grew out of it.
const STOPS_ON_ERROR = /^(?:a|ba|da|k|mk|y|z)?sh$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isPort = (value) => Number.isInteger(value) && value >= 1024 && value <= 65535;

// ---- ports -------------------------------------------------------------------------------------

// A server listens on this computer alone or on every address, in the old numbering or
// the new one. On a Mac one of those can be taken while the others still look free.
const ADDRESSES = ['127.0.0.1', '0.0.0.0', '::1', '::'];

function canListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    // An address this computer doesn't have, such as ::1 without IPv6, is in nobody's way.
    server.once('error', (err) => resolve(!['EADDRINUSE', 'EACCES'].includes(/** @type {any} */ (err).code)));
    server.listen({ port, host, ipv6Only: host === '::' }, () => server.close(() => resolve(true)));
  });
}

/** Whether nothing listens on `port` right now. @param {number} port */
export async function isPortFree(port) {
  for (const host of ADDRESSES) {
    if (!(await canListen(port, host))) return false;
  }
  return true;
}

// ---- a command and everything it started -----------------------------------------------------------

/**
 * Signals a command and everything it started: the command leads a process group of its
 * own, and a negative id means the whole group. Signal 0 only asks whether any of it is left.
 * @returns {boolean}  false when nothing of it is left
 */
function signalAll(pid, signal) {
  try {
    // Windows has no process groups: taskkill ends the command with what it started.
    if (IS_WINDOWS && signal) return spawnSync('taskkill', ['/pid', String(pid), '/t', '/f']).status === 0;
    process.kill(IS_WINDOWS ? pid : -pid, signal);
    return true;
  } catch (err) {
    // Something is there, though not ours to signal.
    return /** @type {any} */ (err).code === 'EPERM';
  }
}

async function goneWithin(pid, ms) {
  const deadline = Date.now() + ms;
  while (signalAll(pid, 0)) {
    if (Date.now() >= deadline) return false;
    await sleep(LOOK_EVERY_MS);
  }
  return true;
}

/**
 * Ends a command and everything it started: asked first and, if any of it is still
 * there after `graceMs`, killed. Resolves once all of it is gone.
 */
async function endAll(pid, graceMs) {
  if (!signalAll(pid, 'SIGTERM')) return;
  if (await goneWithin(pid, graceMs)) return;
  signalAll(pid, 'SIGKILL');
  await goneWithin(pid, KILL_WAIT_MS);
}

/** `promise`, or nothing once `ms` have passed. */
function within(promise, ms) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** @returns {RunView} */
const view = ({ id, kind, script, name, command, urls, port, movedFrom, startedAt, output }) => ({
  id,
  kind,
  script,
  name,
  command,
  urls,
  port,
  movedFrom,
  startedAt,
  output,
  ended: null,
});

/** What a contact's run of one script is kept under: a contact can run several of its project's at once. */
const keyOf = (contactId, scriptId) => `${contactId}\n${scriptId}`;

/**
 * What `spawn` is handed to start a command through a shell, as the user's terminal would. On a Mac
 * or Linux that is their own shell, and the command leads a process group of its own, so that
 * everything it starts can be stopped with it. On Windows it is Git Bash, so that a script says
 * the same there; without it, cmd.exe, which knows neither `$PORT` nor a second line.
 * @param {string} command
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {Record<string, string | undefined>} opts.env
 * @param {string} opts.shell  the user's shell, on a Mac or Linux
 * @param {string | null} opts.bash  Git Bash, on Windows; null where there is none
 * @param {boolean} [opts.stopOnError]  stops it at the first command that fails, where the shell knows how:
 *   sh and the shells that grew out of it do
 * @param {string} [opts.platform]
 * @returns {[string, string[], import('node:child_process').SpawnOptions]}
 */
export function spawnArgs(command, { cwd, env, shell, bash, stopOnError = false, platform = process.platform }) {
  if (platform !== 'win32') {
    const stop = stopOnError && STOPS_ON_ERROR.test(path.basename(shell)) ? ['-e'] : [];
    return [shell, [...stop, '-c', command], { cwd, env, detached: true }];
  }
  if (!bash) return [command, [], { cwd, env, shell: true, windowsHide: true }];
  // Git Bash reads its command line as Cygwin does, not as Node quotes it for Windows programs: outside
  // quotes a line break ends an argument, and inside them a backslash always takes the next character
  // as it is. So the script is quoted its way, and Node quotes nothing: the path of bash itself, which
  // may have a space in it, goes in plain quotes, as Windows reads a program's name.
  const quoted = `"${command.replace(/[\\"]/g, '\\$&')}"`;
  return [
    bash,
    [...(stopOnError ? ['-e'] : []), '-c', quoted],
    { cwd, env, windowsHide: true, windowsVerbatimArguments: true, argv0: `"${bash}"` },
  ];
}

/**
 * Starts a command through a shell (see spawnArgs), there and then: whoever starts it listens to it
 * before it can say anything. On Windows, Git Bash is looked for before that.
 */
function spawnShell(command, { cwd, env, shell, bash, stopOnError }) {
  const child = spawn(...spawnArgs(command, { cwd, env, shell, bash, stopOnError }));
  // Its input is left open and empty: some watchers take the end of their input as the sign to quit.
  child.stdin.on('error', () => {});
  return child;
}

/**
 * Runs a script to its end, for whoever only wants to know how it went: the one that cleans up
 * a worktree before it is removed. Never rejects.
 * @param {string} command
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {Record<string, string | undefined>} [opts.env]
 * @param {string} [opts.shell]
 * @param {number} [opts.timeoutMs]  past this it is stopped, with everything it started
 * @returns {Promise<{ code: number | null, output: string, timedOut: boolean }>}  `code` is null when it could
 *   not be started, was ended by a signal, or took too long
 */
export async function runToEnd(
  command,
  { cwd, env = process.env, shell = env.SHELL || '/bin/sh', timeoutMs = 120000 }
) {
  const bash = IS_WINDOWS ? await gitBash() : null;
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let child;
    try {
      child = spawnShell(command, { cwd, env, shell, bash });
    } catch (err) {
      return resolve({ code: null, output: err.message, timedOut });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      endAll(child.pid, GRACE_MS);
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr]) {
      const reader = new PlainOutput();
      stream.on('data', (chunk) => (output = tailOf(output + reader.read(chunk))));
      stream.on('error', () => {});
    }
    child.once('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, output: output || err.message, timedOut });
    });
    child.once('exit', async (code) => {
      clearTimeout(timer);
      // What it left running goes with it.
      await endAll(child.pid, GRACE_MS);
      resolve({ code: timedOut ? null : code, output, timedOut });
    });
  });
}

export class Runs {
  /** contact and script -> the command running for them, from the moment it is up until all of it is gone */
  #runs = new Map();
  /** contactId -> the start that is under way for it. A contact's are made in turn: the second finds what the first started */
  #starting = new Map();
  /** contact and the script asked for ('' for the button's own) -> its start that is under way, so that Run pressed twice starts one command */
  #asked = new Map();
  /** contact and script -> a run that ended by itself while no window was open to be told */
  #missed = new Map();
  /** Ports are handed out one at a time. */
  #handingOut = Promise.resolve();

  /**
   * @param {object} deps
   * @param {import('./storage/store.js').Store} deps.store  where a project's scripts and a contact's port are kept
   * @param {(contactId: string, event: RunEvent) => boolean} deps.send  tells the contact's conversation
   *   window; false when it has none open
   * @param {Record<string, string | undefined>} [deps.env]  what every command inherits: the login shell's PATH is in it
   * @param {(project: import('./run-command.js').Project, cwd: string) => Record<string, string>} [deps.environment]
   *   the variables a project's commands are started with on top of that (see Projects.environment)
   * @param {string} [deps.shell]  the shell that runs the command; the user's own
   * @param {number} [deps.graceMs]  how long a command gets to stop by itself
   * @param {{ first: number, last: number, step: number }} [deps.ports]  the ports contacts are given
   */
  constructor({
    store,
    send,
    env = process.env,
    environment = () => ({}),
    shell = env.SHELL || '/bin/sh',
    graceMs = GRACE_MS,
    ports = PORTS,
  }) {
    this.store = store;
    this.send = send;
    this.env = env;
    this.environment = environment;
    this.shell = shell;
    this.graceMs = graceMs;
    this.ports = ports;
  }

  /**
   * Tells the contact's conversation window. A window that is just going away can't be
   * told any more than one that is closed, and a command must not trip over that.
   * @param {string} contactId
   * @param {RunEvent} event
   * @returns {boolean}  false when no window heard it
   */
  #tell(contactId, event) {
    try {
      return Boolean(this.send(contactId, event));
    } catch {
      return false;
    }
  }

  // ---- the project's scripts --------------------------------------------------------------------

  #contact(contactId) {
    const contact = this.store.getContact(contactId);
    if (!contact) throw new Error('This contact no longer exists.');
    return contact;
  }

  /**
   * What the dialog that asks for the run command shows.
   * @param {string} contactId
   * @returns {Promise<{ project: string, command: string, suggestion: string }>}  the project's name, its
   *   command ('' when it has none yet), and a guess at one from what is in the contact's folder
   */
  async command(contactId) {
    const { project, scripts, suggestion } = await this.scripts(contactId);
    return { project, command: scripts[0]?.command ?? '', suggestion };
  }

  /**
   * What Run can start for a contact: its project's scripts, the Run button's own first. And
   * the script that sets its worktrees up, with a guess at each where the project has none.
   * @param {string} contactId
   * @returns {Promise<{ project: string, scripts: import('../shared/project-settings.js').Script[], suggestion: string, setup: string, setupSuggestion: string }>}
   */
  async scripts(contactId) {
    const { cwd } = this.#contact(contactId);
    const project = await describeProject(cwd);
    const { scripts, setup } = projectSettings(this.store.getProject(project.key));
    return {
      project: project.name,
      scripts,
      suggestion: suggestRunCommand(cwd),
      setup,
      setupSuggestion: suggestSetupCommand(cwd),
    };
  }

  /**
   * Sets the run command of the contact's project, for every contact working on it: the
   * first of its scripts, which the Run button starts. It may be a few lines, run one after the other.
   * A command that is running is not touched: the new one is used from the next Run.
   * Throws a message for the user when nothing was typed.
   * @param {string} contactId
   * @param {string} value
   * @returns {Promise<{ project: string, command: string }>}
   */
  async setCommand(contactId, value) {
    const { cwd } = this.#contact(contactId);
    const command = cleanCommand(value);
    const project = await describeProject(cwd);
    const { scripts } = projectSettings(this.store.getProject(project.key));
    this.store.updateProject(project.key, { scripts: withRunCommand(scripts, command) });
    return { project: project.name, command };
  }

  /**
   * The command that starts a script file the user picked to run the contact's project with, such
   * as `bin/dev`, for the dialog to show. Nothing is kept until the dialog's answer is.
   * Throws a message for the user for a file outside the contact's folder: the command is run there.
   * @param {string} contactId
   * @param {string} file
   * @returns {Promise<string>}
   */
  async fileCommand(contactId, file) {
    const { cwd } = this.#contact(contactId);
    const project = await describeProject(cwd);
    const command = scriptFileCommand(file, [cwd, ...(project.mainFolder ? [project.mainFolder] : [])]);
    if (!command) {
      throw new Error(
        `Choose a file in ${shortPath(cwd)}: every contact working on ${project.name} runs it from its own folder.`
      );
    }
    return command;
  }

  // ---- a port for each contact -------------------------------------------------------------------

  /**
   * The port to start a contact's command on: the one it has, or a new one when it has
   * none or something else took it. Contacts asking at once are answered in turn, so that
   * no two are handed the port that was free a moment ago.
   * @returns {Promise<{ port: number, movedFrom: number | null }>}
   */
  #port(contactId) {
    const answer = this.#handingOut.then(() => this.#choosePort(contactId));
    this.#handingOut = answer.catch(() => {});
    return answer;
  }

  async #choosePort(contactId) {
    const { port: kept } = this.#contact(contactId);
    // A contact's port is its own also while it runs nothing: its bookmarks point there.
    const others = new Set(this.store.contacts.filter((c) => c.id !== contactId).map((c) => c.port));
    const mine = isPort(kept) ? kept : null;
    if (mine && !others.has(mine) && (await isPortFree(mine))) return { port: mine, movedFrom: null };
    const { first, last, step } = this.ports;
    for (let port = first; port <= last; port += step) {
      if (port === mine || others.has(port) || !(await isPortFree(port))) continue;
      this.store.updateContact(contactId, { port });
      return { port, movedFrom: mine };
    }
    throw new Error(`There is no free port left between ${first} and ${last}.`);
  }

  // ---- starting ----------------------------------------------------------------------------------

  /**
   * Starts one of the project's scripts for a contact: the one named, or the Run button's own.
   * While that one is running, it is the answer and nothing new is started. Throws a message
   * for the user when it can't be started.
   * @param {string} contactId
   * @param {string} [scriptId]
   * @returns {Promise<RunView>}
   */
  start(contactId, scriptId) {
    return this.#once(contactId, typeof scriptId === 'string' ? scriptId : '');
  }

  /**
   * Runs the script that sets up a contact's new worktree, if its project has one. It is shown
   * and stopped like any other run. A pull request's worktree is not set up by itself: the script
   * would run the pull request's code, so it waits for the user to start it (see `setupWaits`).
   * @param {string} contactId
   * @returns {Promise<RunView | null>}  null for a project without one, and while the script waits
   */
  async setup(contactId) {
    if (this.#contact(contactId).setupWaits) return null;
    return this.#once(contactId, SETUP);
  }

  /** Asked for twice before the first answer, a script is started once: both get that answer. */
  #once(contactId, scriptId) {
    const key = keyOf(contactId, scriptId);
    const underWay = this.#asked.get(key);
    if (underWay) return underWay;
    const starting = this.#inTurn(contactId, () => this.#begin(contactId, scriptId));
    this.#asked.set(key, starting);
    const done = () => this.#asked.delete(key);
    starting.then(done, done);
    return starting;
  }

  /** A contact's starts are made one after the other: the second Run finds what the first one started. */
  #inTurn(contactId, begin) {
    const before = this.#starting.get(contactId) ?? Promise.resolve();
    const starting = before.catch(() => {}).then(begin);
    this.#starting.set(contactId, starting);
    const done = () => {
      if (this.#starting.get(contactId) === starting) this.#starting.delete(contactId);
    };
    starting.then(done, done);
    return starting;
  }

  /** The runs of a contact that are not gone yet. */
  #of(contactId) {
    return [...this.#runs.values()].filter((run) => run.contactId === contactId);
  }

  async #begin(contactId, scriptId) {
    const contact = this.#contact(contactId);
    // One that is asked for by name and running is the answer, whatever became of its folder.
    const known = scriptId && this.#runs.get(keyOf(contactId, scriptId));
    if (known && !known.ending) return view(known);
    if (!fs.existsSync(contact.cwd)) throw new Error(`The folder ${shortPath(contact.cwd)} isn’t there any more.`);
    const project = await describeProject(contact.cwd);
    const settings = projectSettings(this.store.getProject(project.key));
    const setup = scriptId === SETUP;
    if (setup && !settings.setup) return null;
    const script = setup
      ? { id: SETUP, name: 'Setup', command: settings.setup }
      : scriptId
        ? settings.scripts.find((s) => s.id === scriptId)
        : settings.scripts[0];
    if (!script) {
      throw new Error(
        scriptId ? `${project.name} has no such script any more.` : `${project.name} has no run command yet.`
      );
    }
    const key = keyOf(contactId, script.id);
    const running = this.#runs.get(key);
    // One on its way out is let go first: its port is about to be free again.
    if (running?.ending) await running.gone;
    else if (running) return view(running);
    const { port, movedFrom } = await this.#port(contactId);
    const child = await this.#spawn(script.command, contact.cwd, port, this.environment(project, contact.cwd), {
      // A run script of a few lines stops at the first that fails: a server started after a failed
      // install would only fail too, further from the reason. A setup script goes on, as it always has.
      stopOnError: !setup && script.command.includes('\n'),
    });
    // Started by the user: a pull request's setup script waits no more.
    if (setup && contact.setupWaits) this.store.updateContact(contactId, { setupWaits: null });

    const run = {
      contactId,
      key,
      id: crypto.randomUUID(),
      kind: setup ? 'setup' : 'run',
      script: script.id,
      name: script.name,
      command: script.command,
      // A setup script serves no page.
      urls: setup ? [] : previewLinks(settings.previewUrls, port),
      port,
      movedFrom,
      startedAt: Date.now(),
      output: '',
      child,
      /** Printed, and not sent to the window yet. */
      unsent: '',
      timer: null,
      /** Whether it was asked to stop. */
      stopped: false,
      /** Set once it is on its way out: resolves when nothing it started is left. */
      ending: null,
    };
    /** Resolves when all of its output has been read. */
    run.closed = new Promise((resolve) => child.once('close', resolve));
    /** Resolves when the run is over and its window has been told. */
    run.gone = new Promise((resolve) => {
      run.over = resolve;
    });
    this.#runs.set(key, run);
    this.#missed.delete(key);
    for (const stream of [child.stdout, child.stderr]) this.#read(run, stream);
    child.once('exit', (code, signal) => this.#exited(run, code, signal));
    this.#tell(contactId, { type: 'started', run: view(run) });
    return view(run);
  }

  /**
   * Resolves with the command once it is running; rejects with a message for the user when it could not be started.
   * @param {{ stopOnError?: boolean }} [how]  see spawnArgs
   */
  async #spawn(command, cwd, port, environment, { stopOnError = false } = {}) {
    // The contact's port is the app's to say, whatever the project's own variables call PORT.
    const ports = { PORT: String(port), BUDDYLIST_PORT: String(port) };
    const env = { ...this.env, ...environment, ...ports };
    const bash = IS_WINDOWS ? await gitBash() : null;
    const child = spawnShell(command, { cwd, env, shell: this.shell, bash, stopOnError });
    return new Promise((resolve, reject) => {
      child.once('spawn', () => resolve(child));
      child.once('error', (err) => reject(new Error(`The command could not be started: ${err.message}.`)));
      // Anything going wrong later, such as a signal that can't be sent, is seen when it ends.
      child.on('error', () => {});
    });
  }

  // ---- what it prints ---------------------------------------------------------------------------------

  #read(run, stream) {
    const reader = new PlainOutput();
    stream.on('data', (chunk) => this.#printed(run, reader.read(chunk)));
    stream.on('end', () => this.#printed(run, reader.end()));
    stream.on('error', () => {});
  }

  #printed(run, text) {
    if (!text) return;
    run.output = tailOf(run.output + text);
    // A command can print faster than a window can draw: what is waiting is cut to its end too.
    run.unsent = tailOf(run.unsent + text);
    run.timer ??= setTimeout(() => this.#sendOutput(run), SEND_EVERY_MS);
  }

  #sendOutput(run) {
    clearTimeout(run.timer);
    run.timer = null;
    if (!run.unsent) return;
    const text = run.unsent;
    run.unsent = '';
    this.#tell(run.contactId, { type: 'output', id: run.id, text });
  }

  // ---- stopping --------------------------------------------------------------------------------------

  /**
   * Stops what a contact's Run started: one script when it is named, or all of them, each with
   * everything it started in turn. Safe to call at any time, also when nothing runs or the
   * contact is gone. Never fails.
   * @param {string} contactId
   * @param {string} [scriptId]
   * @returns {Promise<void>}  resolves once all of it is gone
   */
  async stop(contactId, scriptId) {
    // One that is still being started is let up first, so that there is something to stop.
    // Otherwise it is on its way out from this moment: a Run pressed right after waits for it.
    const starting = this.#starting.get(contactId);
    if (starting) await starting.catch(() => {});
    const asked = typeof scriptId === 'string' && scriptId ? keyOf(contactId, scriptId) : null;
    for (const key of [...this.#missed.keys()]) {
      if (asked ? key === asked : this.#missed.get(key).contactId === contactId) this.#missed.delete(key);
    }
    const runs = this.#of(contactId).filter((run) => !asked || run.key === asked);
    await Promise.all(
      runs.map((run) => {
        // Unless it had just ended by itself: then that is what its window is told.
        if (!run.ending) {
          run.stopped = true;
          run.ending = endAll(run.child.pid, this.graceMs);
        }
        return run.gone;
      })
    );
  }

  /** The command itself has ended: by itself, or because it was stopped. */
  async #exited(run, code, signal) {
    try {
      // What it left running goes with it: a server it put in the background, a child that ignored the stop.
      await (run.ending ??= endAll(run.child.pid, this.graceMs));
      // Something that got away may hold its output open for ever. The rest is not waited for.
      await within(run.closed, LAST_WORDS_MS);
      for (const stream of run.child.stdio) stream?.destroy();
      this.#sendOutput(run);
      const ended = { code, signal, stopped: run.stopped };
      const told = this.#tell(run.contactId, { type: 'ended', id: run.id, ...ended });
      // One that was stopped ended as asked: there is nothing to tell a window that opens later.
      if (!told && !run.stopped) this.#missed.set(run.key, { contactId: run.contactId, view: { ...view(run), ended } });
    } finally {
      // Whatever went wrong on the way: whoever waits for it to be gone, the quitting app included, is let go.
      this.#runs.delete(run.key);
      run.over();
    }
  }

  /**
   * What a conversation window is shown when it opens: the commands running for its
   * contact, each with its output so far, in the order they were started. And the ones that
   * ended by themselves while no window was open to be told, which are told this once.
   * @param {string} contactId
   * @returns {RunView[]}
   */
  state(contactId) {
    const missed = [];
    for (const [key, run] of this.#missed) {
      if (run.contactId !== contactId) continue;
      missed.push(run.view);
      this.#missed.delete(key);
    }
    return [...missed, ...this.#of(contactId).map(view)].sort((a, b) => a.startedAt - b.startedAt);
  }

  // ---- the app quits -----------------------------------------------------------------------------------

  /** Stops every command. Resolves once all of them are gone. */
  async stopAll() {
    // One that is still being started is let up first, so that it is stopped too.
    await Promise.allSettled([...this.#starting.values()]);
    await Promise.all([...new Set([...this.#runs.values()].map((run) => run.contactId))].map((id) => this.stop(id)));
  }

  /**
   * For the app's `before-quit`: while anything runs the quit is held back, everything is
   * stopped, and then the app is asked to quit again.
   * @param {{ preventDefault: () => void }} event
   * @param {() => void} quit
   */
  holdQuit(event, quit) {
    if (!this.#runs.size && !this.#starting.size) return;
    event.preventDefault();
    this.stopAll().finally(quit);
  }

  /** The last resort as the app goes: whatever is still there is killed at once, without waiting. */
  killAll() {
    for (const run of this.#runs.values()) {
      run.stopped ||= !run.ending;
      signalAll(run.child.pid, 'SIGKILL');
    }
  }
}
