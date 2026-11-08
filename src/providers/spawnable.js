// How a CLI is started without a shell. On macOS and Linux it is started by its name, and the
// system finds it. Windows finds only real programs that way, and a CLI installed with npm is
// a batch file there ("codex.cmd"): only cmd.exe can run one, and Node won't start one without
// a shell. So on Windows the CLI is looked for the way cmd.exe would, and a batch file is
// handed to cmd.exe with its arguments written out for it.
import fs from 'node:fs';
import path from 'node:path';

// What Windows starts by itself, and what it starts with cmd.exe: a batch file. Whatever else
// PATHEXT names (.js, .vbs) opens in the program it belongs to and not as a CLI, so it is not
// looked for.
const PROGRAM = /\.(?:exe|com)$/i;
const RUNNABLE = /\.(?:exe|com|cmd|bat)$/i;
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
// What cmd.exe does something with when it is not in quotes. Each is escaped with a caret.
const CMD_SPECIAL = /[()[\]%!^"`<>&|;, *?]/g;

/**
 * A variable of `env`, whatever its case: Windows has "Path" and "ComSpec", and a copy of
 * process.env keeps that. With two spellings, the program gets the first in sorting order.
 */
const variable = (env, name) => {
  const [key] = Object.keys(env)
    .filter((key) => key.toUpperCase() === name)
    .sort();
  return key === undefined ? undefined : env[key];
};

/**
 * Where `command` is: where it points when it is a path, or else in the first folder of PATH
 * that has it. A name without one of the extensions is tried with each in PATHEXT in turn, so
 * the batch file npm puts next to a script for sh is found, and not the script.
 * @returns {string | undefined}
 */
function lookFor(command, env, exists) {
  const extensions = (variable(env, 'PATHEXT') || DEFAULT_PATHEXT)
    .split(';')
    .filter((extension) => RUNNABLE.test(extension))
    .map((extension) => extension.toLowerCase());
  const names = RUNNABLE.test(command) ? [command] : extensions.map((extension) => command + extension);
  if (/[\\/:]/.test(command)) return names.find((name) => exists(name));
  const folders = (variable(env, 'PATH') || '').split(';').map((folder) => folder.replace(/^"(.*)"$/, '$1'));
  for (const folder of folders.filter(Boolean)) {
    const found = names.map((name) => path.win32.join(folder, name)).find((file) => exists(file));
    if (found) return found;
  }
  return undefined;
}

/** The executable the operating system will find, for showing the install being checked. */
export function executablePath(command, { env = process.env, platform = process.platform, exists } = {}) {
  if (platform === 'win32') return lookFor(command, env, exists ?? fs.existsSync);
  const runnable =
    exists ??
    ((file) => {
      try {
        fs.accessSync(file, fs.constants.X_OK);
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    });
  if (command.includes('/')) return runnable(command) ? path.posix.resolve(command) : undefined;
  return (env.PATH ?? '/usr/bin:/bin')
    .split(':')
    .map((folder) => path.posix.resolve(folder || '.', command))
    .find(runnable);
}

/**
 * One argument to a batch file, written so that it arrives as it was. It is put in quotes the
 * way the program the batch file starts reads them (Microsoft's C runtime: a backslash before a
 * quote is escaped too), and each character cmd.exe would act on is escaped twice: once for
 * cmd.exe reading the command, and once more for the batch file, which reads its arguments
 * again where it hands them on with %*. A line break can't be passed this way at all.
 */
function forBatch(arg) {
  const quoted = arg.replace(/\\+|"/g, (found, at) => {
    if (found === '"') return '\\"';
    const next = arg[at + found.length];
    return next === '"' || next === undefined ? found + found : found;
  });
  return `"${quoted}"`.replace(CMD_SPECIAL, '^^^$&');
}

/**
 * What to hand spawn() or execFile() to start `command` with `args`.
 * @param {string} command  a name to look for on PATH, or a path
 * @param {string[]} args
 * @param {object} [opts]
 * @param {Record<string, string | undefined>} [opts.env]  what the CLI is started with: its PATH,
 *   PATHEXT and ComSpec say where to look and what runs a batch file
 * @param {string} [opts.platform]  a stand-in for tests
 * @param {(file: string) => boolean} [opts.exists]  a stand-in for tests
 * @returns {{ file: string, args: string[], windowsVerbatimArguments?: boolean }}  the last is
 *   true when the arguments are written for cmd.exe already, so Node must not quote them again
 */
export function spawnable(
  command,
  args,
  { env = process.env, platform = process.platform, exists = fs.existsSync } = {}
) {
  if (platform !== 'win32') return { file: command, args };
  const file = lookFor(command, env, exists);
  // Started by its name, a CLI that is nowhere fails as it always did, and the user is told to install it.
  if (!file) return { file: command, args };
  if (PROGRAM.test(file)) return { file, args };
  const line = [`"${path.win32.normalize(file)}"`, ...args.map(forBatch)].join(' ');
  return {
    file: variable(env, 'COMSPEC') || 'cmd.exe',
    // /d: none of the user's own AutoRun commands. /v:off: a "!" is only a letter. /s /c: run
    // what is between the outer quotes as it is.
    args: ['/d', '/v:off', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  };
}
