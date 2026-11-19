// Apps launched from Finder, or from a Linux desktop's menu, get a bare PATH. Borrow the login
// shell's so the agent's shell commands find git, node, brew, etc., just like in Terminal.
// Windows apps get the whole PATH as it is: there is nothing to ask there at the start.
// The shell is asked in the background: running its start-up files takes it half a
// second or more, and the first window is not kept waiting for that.
// Check again asks once more (see reload): a program installed while the app is open is on a PATH that only
// the start-up files of a shell started since say, and on Windows only the registry.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { runCli } from '../providers/setup.js';
import { variable } from '../providers/spawnable.js';

// How long what is started at first waits for the shell's PATH. A shell that answers later is still listened to.
const WAIT_MS = 5000;
// A shell, or Windows' PowerShell, that has not answered by then is not waited for any longer.
const TIMEOUT_MS = 30000;
const MARKED = /__PATH__(.*)__PATH__/s;

/**
 * The PATH the login shell gives what is started from Terminal.
 * @param {object} opts
 * @param {string} opts.shell
 * @param {number} opts.timeout  how long it gets, in milliseconds
 * @returns {Promise<string | undefined>}  none when it said none in time. Never rejects
 */
function loginShellPath({ shell, timeout }) {
  return new Promise((resolve) => {
    let out = '';
    let timer = null;
    // Once printed, the PATH is taken, however the shell leaves after: a `.zlogout` or a trap can leave with 1. The
    // shell is left to finish by itself, its `.zlogout` too, unless it is still there at the timeout.
    const answer = (found) => resolve(found || undefined);
    const done = () => {
      clearTimeout(timer);
      answer();
    };
    try {
      const child = spawn(shell, ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      // Something its start-up files left running can hold its output open long after the shell itself is gone,
      // and an interactive shell takes no notice of SIGTERM: the wait ends here either way.
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        child.stdout.destroy();
        answer();
      }, timeout);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        out += chunk;
        const found = out.match(MARKED)?.[1];
        if (found !== undefined) answer(found);
      });
      child.on('error', done);
      child.on('close', done);
    } catch {
      done();
    }
  });
}

// The PATH Windows gives a program started now: the system's, then the user's, as the registry keeps them.
// Encoded, so no quoting stands in its way; in UTF-8 without a mark, so a folder with an accent arrives whole.
const WINDOWS_PATH = Buffer.from(
  "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); 'Machine', 'User' | ForEach-Object { [Environment]::GetEnvironmentVariable('Path', $_) }",
  'utf16le'
).toString('base64');

/** What `env` calls its PATH: "Path" on Windows. */
const pathKey = (env) => Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';

/**
 * PowerShell's answer to WINDOWS_PATH.
 * @param {{ env: Record<string, string | undefined>, timeout: number }} opts
 * @returns {Promise<string>}  '' when it gave none
 */
const askPowerShell = async ({ env, timeout }) => {
  const powershell = path.win32.join(
    variable(env, 'SYSTEMROOT') || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const { code, stdout } = await runCli(
    powershell,
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', WINDOWS_PATH],
    { env, timeout }
  );
  return code === 0 ? stdout : '';
};

/**
 * The PATH a program started now would get on Windows, with what the app's own PATH has besides, after it.
 * @param {object} opts
 * @param {Record<string, string | undefined>} opts.env
 * @param {number} opts.timeout
 * @param {typeof askPowerShell} [opts.ask]  a stand-in for tests
 * @returns {Promise<string | undefined>}  none when Windows could not be asked
 */
async function windowsPath({ env, timeout, ask = askPowerShell }) {
  const fresh = (await ask({ env, timeout })).split(/\r?\n|;/);
  if (!fresh.some(Boolean)) return undefined;
  const seen = new Set();
  return [...fresh, ...(variable(env, 'PATH') ?? '').split(';')]
    .map((folder) => folder.trim())
    .filter((folder) => {
      const key = folder.toLowerCase();
      if (!folder || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(';');
}

/**
 * The PATH programs are looked for on: the login shell's, asked once at the start, and again on reload.
 * @param {object} [opts]  stand-ins for tests
 * @param {string} [opts.platform]
 * @param {Record<string, string | undefined>} [opts.env]  where SHELL is read and PATH is set
 * @param {number} [opts.wait]  how long `ready` waits for the first answer, in milliseconds
 * @param {number} [opts.timeout]  how long the shell gets, in milliseconds
 * @param {typeof askPowerShell} [opts.askWindows]
 * @returns {{ ready: Promise<void>, reload: () => Promise<void> }}  `ready`: done once PATH is the login shell's, or
 *   once the wait is over. `reload`: asks again, and is done once PATH is what it said; one asking at a time. Neither
 *   rejects
 */
export function createLoginPath({
  platform = process.platform,
  env = process.env,
  wait = WAIT_MS,
  timeout = TIMEOUT_MS,
  askWindows,
} = {}) {
  /** @type {Promise<void> | null} */
  let asking = null;
  const ask = () =>
    platform === 'win32'
      ? windowsPath({ env, timeout, ask: askWindows })
      : loginShellPath({ shell: env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh'), timeout });
  const reload = () =>
    (asking ??= ask()
      .then((found) => {
        if (found) env[pathKey(env)] = found;
      })
      .finally(() => {
        asking = null;
      }));
  if (platform === 'win32') return { ready: Promise.resolve(), reload };
  const first = reload();
  let timer = null;
  const ready = Promise.race([first, new Promise((resolve) => (timer = setTimeout(resolve, wait)))]).finally(() =>
    clearTimeout(timer)
  );
  return { ready, reload };
}

/**
 * `fn`, held back until `ready` is done, each time it is called: for whatever starts a program,
 * which must not go looking for it before the login shell has said where programs are.
 * @template {(...args: any[]) => any} F
 * @param {Promise<unknown>} ready  never rejects
 * @param {F} fn
 * @returns {(...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>}
 */
export const waitingFor =
  (ready, fn) =>
  async (...args) => {
    await ready;
    return fn(...args);
  };
