// Whether a CLI is on this computer and signed in, asked of the CLI itself without
// starting a session. The welcome wizard lists the answers, so a missing sign-in is
// found before the first message is. A CLI that signs in through the browser by itself
// can be asked to do that as well.
import { execFile } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { executablePath, spawnable } from './spawnable.js';

/** How long a CLI gets to say how it stands. */
const PATIENCE_MS = 8000;

/**
 * ready: there, and signed in as far as it can say. signed-out: there, without a sign-in.
 * missing: not installed. unknown: it gave no answer.
 * @typedef {'ready' | 'signed-out' | 'missing' | 'unknown'} SetupState
 */

/**
 * @typedef {Object} Setup
 * @property {SetupState} state
 * @property {string} note  what to do about it, in words for the user; '' when there is nothing to say
 * @property {string} [path]  the executable found for the check
 * @property {string} [version]  the version reported by --version, when available
 * @property {boolean} [bundled]  whether this is the Claude Code that comes with buddylist
 */

/**
 * How a CLI left, as far as it tells how it stands.
 * @typedef {Object} CliAnswer
 * @property {number | string} code  what it left with: 0 when all is well, or why it could not be started ("ENOENT")
 * @property {boolean} killed        it took too long, and was stopped
 * @property {string} stdout        what it printed; only version output is shown to the user
 */

/**
 * How a sign-in started from the app ended.
 * @typedef {Object} SignInResult
 * @property {boolean} ok      the CLI says it is signed in now
 * @property {string} message  why it is not, in the CLI's own words; '' when it is, and when it was called off
 */

/** @type {Readonly<Setup>} */
export const READY = Object.freeze({ state: 'ready', note: '' });
/** @type {Readonly<Setup>} */
export const UNKNOWN = Object.freeze({ state: 'unknown', note: '' });
/** @type {Readonly<SignInResult>} a sign-in that was called off, or that can't be started from the app */
export const NOT_SIGNED_IN = Object.freeze({ ok: false, message: '' });

/**
 * Runs a CLI and says how it left. It never rejects: a CLI that is not there is an answer too.
 * @param {string} command
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, timeout?: number, platform?: string }} [opts]  `platform`: a stand-in for tests
 * @returns {Promise<CliAnswer>}
 */
export function runCli(command, args, { env = process.env, timeout = PATIENCE_MS, platform } = {}) {
  return new Promise((resolve) => {
    let child;
    let timer;
    const done = (answer) => {
      clearTimeout(timer);
      resolve(answer);
    };
    try {
      // On Windows a CLI installed with npm is a batch file, which is run through cmd.exe.
      const { file, args: argv, windowsVerbatimArguments } = spawnable(command, args, { env, platform });
      child = execFile(file, argv, { env, windowsHide: true, windowsVerbatimArguments }, (err, stdout) =>
        done({ code: err ? (err.code ?? err.signal ?? 1) : 0, killed: false, stdout: stdout || '' })
      );
      // execFile's timeout only sends SIGTERM and waits for close. A CLI can ignore that,
      // or leave a child holding its pipes open. Finish the probe ourselves at the deadline.
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        child.stdout?.destroy();
        child.stderr?.destroy();
        done({ code: 1, killed: true, stdout: '' });
      }, timeout);
    } catch (err) {
      done({ code: err?.code ?? 1, killed: false, stdout: '' });
    }
  });
}

/**
 * Asks a CLI how it stands.
 * @param {object} cli
 * @param {string} [cli.command]  the CLI; none when it could not even be found
 * @param {string[]} cli.args     what makes it leave with 0 only when it is signed in. A CLI that can't be
 *   asked that is asked for its version, and is ready when it is there
 * @param {string} cli.install    what to do when it is not installed
 * @param {string} cli.signIn     what to do when it is not signed in
 * @param {string} [cli.ready]    what there is to say about one that is ready
 * @param {NodeJS.ProcessEnv} [cli.env]
 * @param {boolean} [cli.version]  also ask --version when the check is for sign-in
 * @param {boolean} [cli.bundled]
 * @param {{ run?: typeof runCli }} [deps]  replaceable in tests
 * @returns {Promise<Setup>}
 */
export async function cliSetup(
  { command, args, install, signIn, ready = '', env, version = false, bundled = false },
  { run = runCli } = {}
) {
  if (!command) return { state: 'missing', note: install };
  const path = executablePath(command, { env });
  const versionOnly = args.length === 1 && args[0] === '--version';
  const [answer, release] = await Promise.all([
    run(command, args, { env }),
    version && !versionOnly ? run(command, ['--version'], { env }) : null,
  ]);
  const { code, killed } = answer;
  const output = versionOnly ? answer : release;
  // Keep banners, terminal escapes and unrelated auth output out of the summary.
  const foundVersion =
    output?.code === 0 && !output.killed
      ? stripVTControlCharacters(output.stdout || '').match(
          /(?:^|[^\w.])v?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?\b)/i
        )?.[1]
      : undefined;
  const details = {
    ...(path && { path }),
    ...(foundVersion && { version: foundVersion }),
    ...(bundled && { bundled }),
  };
  if (killed) return { ...details, state: 'unknown', note: 'The check timed out after 8 seconds. Try Check again.' };
  // A number is what the CLI left with. Anything else is why it never started.
  if (code === 'ENOENT') return { ...details, state: 'missing', note: install };
  if (typeof code !== 'number')
    return {
      ...details,
      state: 'unknown',
      note:
        code === 'EACCES'
          ? 'The program could not start (EACCES). Check its path and permissions.'
          : `The check failed (${code}). Try running the program in Terminal.`,
    };
  if (code === 0) return { ...details, state: 'ready', note: ready };
  return {
    ...details,
    state: versionOnly ? 'unknown' : 'signed-out',
    note: versionOnly ? `The program exited with code ${code}. ${signIn}` : signIn,
  };
}

/**
 * Runs a CLI's own sign-in: one that opens the browser and hears the answer on this computer, so
 * that it needs no terminal. It waits for as long as the user takes, and never rejects.
 * @param {object} cli
 * @param {string} [cli.command]  the CLI; none when it could not even be found
 * @param {string[]} cli.args     what makes it sign in, and leave with 0 only when that worked
 * @param {NodeJS.ProcessEnv} [cli.env]
 * @param {{ signal?: AbortSignal, platform?: string }} [opts]  `signal`: calls the sign-in off, and stops the
 *   CLI. `platform`: a stand-in for tests
 * @returns {Promise<SignInResult>}
 */
export function cliSignIn({ command, args, env = process.env }, { signal, platform } = {}) {
  return new Promise((resolve) => {
    const failed = (stderr = '') => {
      if (signal?.aborted) return resolve(NOT_SIGNED_IN);
      // What it said on its way out is why: "Login failed: ...", and what to do about it.
      const said = String(stderr)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ');
      resolve({ ok: false, message: said || 'The sign-in did not go through. Try again.' });
    };
    if (!command) return failed();
    try {
      const { file, args: argv, windowsVerbatimArguments } = spawnable(command, args, { env, platform });
      execFile(file, argv, { env, signal, windowsHide: true, windowsVerbatimArguments }, (err, _stdout, stderr) =>
        err ? failed(stderr) : resolve({ ok: true, message: '' })
      );
    } catch {
      failed();
    }
  });
}
