// How the app starts git and gh by itself, in a contact's folder or anywhere else. Each is started from
// where it really is, found on the PATH alone: never by a name the folder it is started in could answer
// to, as Windows looks there first. And git is told to start none of the programs a folder's own git
// settings could name: the file system monitor, and hooks. What is asked of them stays the caller's.
import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { executablePath, spawnable } from '../providers/spawnable.js';

/**
 * What every git the app starts is told on top of the settings it finds: no file system monitor, which is
 * a program the settings name, and no hooks, which are programs in a folder they name.
 */
const SETTINGS = [
  ['core.fsmonitor', 'false'],
  ['core.hooksPath', '/dev/null'],
];

/** The same settings as git takes them on its command line. */
export const GIT_SETTINGS = SETTINGS.flatMap(([key, value]) => ['-c', `${key}=${value}`]);

/**
 * The same settings as variables, after any the environment has already: gh starts git itself, and the git
 * it starts reads them too.
 * @param {Record<string, string | undefined>} env
 */
export function withGitSettings(env) {
  const had = /^\d+$/.test(env.GIT_CONFIG_COUNT ?? '') ? Number(env.GIT_CONFIG_COUNT) : 0;
  const more = Object.fromEntries(
    SETTINGS.flatMap(([key, value], i) => [
      [`GIT_CONFIG_KEY_${had + i}`, key],
      [`GIT_CONFIG_VALUE_${had + i}`, value],
    ])
  );
  return { ...env, ...more, GIT_CONFIG_COUNT: String(had + SETTINGS.length) };
}

// ---- where git and gh are -------------------------------------------------------------------------

/**
 * The environment with only the folders of its PATH that are named in full: a folder named from where a
 * program is started, "." or "bin", would be the folder git is started in.
 */
function absolutePath(env, platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const delimiter = platform === 'win32' ? ';' : ':';
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) =>
      key.toUpperCase() === 'PATH' && typeof value === 'string'
        ? [
            key,
            value
              .split(delimiter)
              .filter((folder) => paths.isAbsolute(folder.replace(/^"(.*)"$/, '$1')))
              .join(delimiter),
          ]
        : [key, value]
    )
  );
}

/**
 * Where a program is, in full, as found on the PATH: null where it is nowhere there.
 * @param {string} name  such as "git"
 * @param {{ env?: Record<string, string | undefined>, platform?: string, exists?: (file: string) => boolean }} [opts]
 *   stand-ins for tests
 * @returns {string | null}
 */
export function findTool(name, { env = process.env, platform = process.platform, exists } = {}) {
  return executablePath(name, { env: absolutePath(env, platform), platform, exists }) ?? null;
}

/** @type {Map<string, string | null>} a program and the PATH it was looked for on -> where it was found */
const found = new Map();
const pathOf = (env) => Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';

/** Where a program is, looked for once for each PATH the app has: the login shell's arrives after the app starts. */
function toolPath(name, env) {
  const key = `${name}\0${pathOf(env)}`;
  if (!found.has(key)) found.set(key, findTool(name, { env }));
  return found.get(key);
}

// ---- a worktree's link to its repository ------------------------------------------------------------

/** The folders the app makes its worktrees in (see checkWorktreesIn). */
const homes = new Set();

/**
 * Has git run in a worktree made in one of these folders only while it still belongs to its repository: its
 * `.git` is the file git wrote, naming the repository's own folder for it, `<repository>/.git/worktrees/<name>`.
 * One that names a folder of its own instead, or is made a repository of its own, is no longer the repository's,
 * and git would read its settings from the worktree. The app says where its worktrees go as it starts.
 * @param {(string | null | undefined)[]} folders
 */
export function checkWorktreesIn(folders) {
  for (const folder of folders) if (folder) homes.add(path.resolve(folder));
}

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const inside = (parent, folder) => {
  const rel = path.relative(parent, folder);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** The worktree a folder is in, among the ones made in `homes`: <home>/<project>/<branch>. Null for any other. */
function worktreeOf(cwd) {
  const at = real(cwd);
  for (const home of [...homes].map(real)) {
    const [project, branch] = path.relative(home, at).split(path.sep);
    if (!inside(home, at) || !project || !branch) continue;
    return { top: path.join(home, project, branch), homes: [...homes].map(real) };
  }
  return null;
}

/**
 * Whether a worktree still belongs to its repository as git made it: see checkWorktreesIn.
 * @param {string} top  the worktree's own folder
 * @param {string[]} [others]  folders its repository is never in: where worktrees are made
 */
export function linkedAsMade(top, others = []) {
  try {
    const file = path.join(top, '.git');
    if (!fs.lstatSync(file).isFile()) return false;
    const named = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(file, 'utf8'))?.[1];
    if (!named) return false;
    const own = fs.realpathSync(path.resolve(top, named));
    const read = (name) => fs.realpathSync(path.resolve(own, fs.readFileSync(path.join(own, name), 'utf8').trim()));
    const repository = fs.realpathSync(path.dirname(path.dirname(own)));
    return (
      path.basename(path.dirname(own)) === 'worktrees' &&
      // Where git reads the repository's settings from, and where the repository says this worktree is.
      read('commondir') === repository &&
      read('gitdir') === fs.realpathSync(file) &&
      ![real(top), ...others].some((folder) => inside(folder, repository))
    );
  } catch {
    return false;
  }
}

/** Why git was not started in a worktree whose link to its repository was changed. */
export const LINK_CHANGED =
  'This worktree’s link to its repository was changed, so buddylist doesn’t run git in it. Delete the worktree, or make it again.';

// ---- starting them ----------------------------------------------------------------------------------

const notFound = (name) =>
  Object.assign(new Error(`spawn ${name} ENOENT`), { code: 'ENOENT', errno: -2, syscall: `spawn ${name}`, path: name });

/**
 * What starts git or gh: where it is, the arguments, and its options.
 * @param {'git' | 'gh'} tool
 * @param {string[]} args
 * @param {Record<string, any>} [options]  as execFile and spawn take them, and `file`: a program to start instead,
 *   a stand-in for tests
 * @throws {Error}  with the code ENOENT where it is nowhere on the PATH, and LINK_CHANGED in such a worktree
 */
function prepare(tool, args, { file: standIn, ...options } = {}) {
  const env = options.env ?? process.env;
  if (options.cwd) {
    const worktree = worktreeOf(options.cwd);
    if (worktree && !linkedAsMade(worktree.top, worktree.homes)) throw new Error(LINK_CHANGED);
  }
  const file = standIn ?? toolPath(tool, env);
  if (!file) throw notFound(tool);
  const start = spawnable(file, tool === 'git' ? [...GIT_SETTINGS, ...args] : args, { env });
  return {
    file: start.file,
    args: start.args,
    options: {
      ...options,
      env: tool === 'gh' ? withGitSettings(env) : env,
      ...(start.windowsVerbatimArguments && { windowsVerbatimArguments: true }),
    },
  };
}

/**
 * execFile for git or gh (see prepare). One that can't be started is answered as execFile answers it.
 * @param {'git' | 'gh'} tool
 * @param {string[]} args
 * @param {Record<string, any>} options
 * @param {(err: (Error & Record<string, any>) | null, stdout: string, stderr: string) => void} callback
 */
export function execTool(tool, args, options, callback) {
  let start;
  try {
    start = prepare(tool, args, options);
  } catch (err) {
    process.nextTick(callback, err, '', '');
    return null;
  }
  return execFile(start.file, start.args, start.options, callback);
}

/** execFileSync for git or gh (see prepare). Throws when it can't be started. */
export function execToolSync(tool, args, options) {
  const start = prepare(tool, args, options);
  return execFileSync(start.file, start.args, start.options);
}

/** spawn for git or gh (see prepare). Throws when it can't be started. */
export function spawnTool(tool, args, options) {
  const start = prepare(tool, args, options);
  return spawn(start.file, start.args, start.options);
}
