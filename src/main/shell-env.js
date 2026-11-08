// Apps launched from Finder, or from a Linux desktop's menu, get a bare PATH. Borrow the login
// shell's so the agent's shell commands find git, node, brew, etc., just like in Terminal.
// Windows apps get the whole PATH as it is: there is nothing to ask there.
// The shell is asked in the background: running its start-up files takes it half a
// second or more, and the first window is not kept waiting for that.
import { spawn } from 'node:child_process';

// A shell that has not answered by then is not waited for any longer.
const TIMEOUT_MS = 5000;

/**
 * Starts asking the login shell for its PATH, and puts that in `env` when it answers.
 * @param {object} [opts]  stand-ins for tests
 * @param {string} [opts.platform]
 * @param {Record<string, string | undefined>} [opts.env]  where SHELL is read and PATH is set
 * @param {number} [opts.timeout]  how long the shell gets, in milliseconds
 * @returns {Promise<void>}  done once PATH is the login shell's, or stays as it was. Never rejects.
 */
export function loadLoginShellPath({ platform = process.platform, env = process.env, timeout = TIMEOUT_MS } = {}) {
  if (platform === 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    let out = '';
    let timer = null;
    let settled = false;
    // With `path` it answered in time. Without, the default PATH is kept.
    const done = (path) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (path) env.PATH = path;
      resolve();
    };
    try {
      const shell = spawn(
        env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh'),
        ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      );
      // Something its start-up files left running can hold its output open long after the shell
      // itself is gone: the wait ends here either way.
      timer = setTimeout(() => {
        shell.kill();
        shell.stdout.destroy();
        done();
      }, timeout);
      shell.stdout.setEncoding('utf8');
      shell.stdout.on('data', (chunk) => {
        out += chunk;
      });
      shell.on('error', () => done());
      shell.on('close', (code) => done(code === 0 ? out.match(/__PATH__(.*)__PATH__/s)?.[1] : null));
    } catch {
      done();
    }
  });
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
