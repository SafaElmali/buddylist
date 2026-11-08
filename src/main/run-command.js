// The run command belongs to a project, not to one contact: which project a
// folder is part of, a guess at what starts it, and the command that starts a
// script file picked for it.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cleanScript } from '../shared/project-settings.js';

// Looking at a repository should feel instant; past this the folder counts as having none.
const LOOK_TIMEOUT_MS = 4000;

/**
 * @typedef {Object} Project
 * @property {string} key   what the app keeps its settings under: the same for every folder of the project
 * @property {string} name  what to call it: the folder of its main checkout
 * @property {string} root  its main checkout, which its worktrees were made from; outside a repository, the folder
 * @property {string} [mainFolder]  for a folder in one of its worktrees, the same folder in its main checkout, or
 *   the checkout's top when only the worktree's branch has that folder. Left out for any other folder. An agent
 *   is set up with what its project has there, not with what the worktree's branch has, which may be anyone's
 */

/**
 * Where a folder really is, which a project's key is made from. A folder may be reached through a
 * symlink, as macOS temp folders are. Windows takes it in any letter case as well, c:\users\me\shop
 * for C:\Users\Me\shop, so there the disk itself says how the folder is written, and a project has
 * one key however its folders were typed. A drive that can't say, as a RAM disk can't, gets the
 * plain answer. So do macOS and Linux: the keys their settings are kept under were made from it.
 * @param {string} p
 * @param {string} [platform]
 * @returns {string}  `p` itself for a folder that isn't there
 */
export function realPath(p, platform = process.platform) {
  const answers = platform === 'win32' ? [fs.realpathSync.native, fs.realpathSync] : [fs.realpathSync];
  for (const answer of answers) {
    try {
      return answer(p);
    } catch {
      // not there, or on a drive that cannot be asked this way
    }
  }
  return p;
}

// The .git folder a checkout and all its worktrees share, the folder's own, and where in its checkout it is.
const LOOK = ['rev-parse', '--path-format=absolute', '--git-common-dir', '--git-dir', '--show-prefix'];

/**
 * What git said of a folder, or null outside a repository.
 * @param {string} said
 * @returns {{ gitDir: string, own: string, prefix: string } | null}
 */
function gitSaid(said) {
  const [gitDir, own, prefix = ''] = said.split(/\r?\n/);
  return gitDir ? { gitDir: realPath(gitDir), own: realPath(own || gitDir), prefix } : null;
}

function lookAt(cwd) {
  return new Promise((resolve) => {
    execFile('git', LOOK, { cwd, timeout: LOOK_TIMEOUT_MS, windowsHide: true }, (err, stdout) =>
      resolve(err ? null : gitSaid(stdout))
    );
  });
}

/** The project of a folder, from the .git folder git said it shares. */
function projectOf(cwd, gitDir) {
  if (!gitDir) return { key: `dir:${realPath(cwd)}`, name: path.basename(realPath(cwd)), root: realPath(cwd) };
  // A bare repository is its own folder; a checkout's is the one around its .git.
  const root = path.basename(gitDir) === '.git' ? path.dirname(gitDir) : gitDir;
  return { key: `git:${gitDir}`, name: path.basename(root).replace(/\.git$/, ''), root };
}

/**
 * The project of a folder, from what git said of it. A checkout owns the .git folder it shares; a
 * worktree has a small one of its own inside that, and the main checkout has the same folder as it.
 * @param {string} cwd
 * @param {ReturnType<typeof gitSaid>} said
 * @returns {Project}
 */
function projectFound(cwd, said) {
  const project = projectOf(cwd, said?.gitDir);
  if (!said || said.own === said.gitDir) return project;
  const same = path.resolve(project.root, said.prefix);
  return { ...project, mainFolder: fs.existsSync(same) ? same : project.root };
}

/**
 * The project a folder belongs to. In a git repository that is the repository, whichever
 * worktree, branch or subfolder of it the folder is: the .git folder they share tells them
 * apart from another repository, also from one whose folder has the same name. Anywhere
 * else the project is the folder itself.
 * @param {string} cwd
 * @returns {Promise<Project>}  never fails: without git, or without the folder, it is the folder
 */
export async function describeProject(cwd) {
  return projectFound(cwd, fs.existsSync(cwd) ? await lookAt(cwd) : null);
}

/**
 * The same, for whoever can't wait for the answer: an agent is started where it is asked for.
 * The app stands still while git answers, so this is not for anything that is asked often.
 * @param {string} cwd
 * @returns {Project}
 */
export function describeProjectSync(cwd) {
  if (!fs.existsSync(cwd)) return projectOf(cwd, null);
  try {
    const said = execFileSync('git', LOOK, {
      cwd,
      timeout: LOOK_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return projectFound(cwd, gitSaid(said));
  } catch {
    return projectOf(cwd, null);
  }
}

/**
 * The project a key is of, as far as the key itself says: its name and where it is.
 * @param {string} key
 * @returns {Project}
 */
export function projectOfKey(key) {
  const at = key.replace(/^(git|dir):/, '');
  return key.startsWith('git:') ? projectOf(at, at) : { key, name: path.basename(at), root: at };
}

/**
 * What the user typed as the run command: one line, or a few run one after the other, line
 * breaks kept. Throws a message for them if it is nothing.
 */
export function cleanCommand(value) {
  const command = cleanScript(String(value ?? '').trim());
  if (!command) throw new Error('Type the command that starts this project.');
  return command;
}

// ---- a script file as the run command ------------------------------------------------------------

/** A path as the shell reads it: as it is, or in single quotes where it has a space or more in it. */
const shellWord = (word) => (/^[\w./@%+=:,-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);

/** The first line of a file, from the start of it alone: a script picked may be anything. */
function firstLine(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const start = Buffer.alloc(256);
    return start.toString('utf8', 0, fs.readSync(fd, start, 0, start.length, 0)).split(/\r?\n/)[0];
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The program that runs a script which can't be started by itself: the one its first line names,
 * as `#!/usr/bin/env bash` names bash, or else sh.
 */
function interpreterOf(file) {
  const named = /^#!\s*(\S.*)$/.exec(firstLine(file))?.[1].trim();
  return named ? named.replace(/^\/usr\/bin\/env\s+/, '') : 'sh';
}

/**
 * Whether a file can be started by itself. On Windows Git Bash looks at its first line instead,
 * so every file can.
 */
function startsByItself(file, platform) {
  if (platform === 'win32') return true;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The run command that starts a script file the user picked: its path from the folder it is in,
 * which the command is run in for every contact, such as `bin/dev`. A script that can't be started
 * by itself is handed to the program its first line names, as `bash scripts/start.sh`, and so
 * nothing about the file has to change.
 * @param {string} file
 * @param {string[]} folders  the folders it may be in: the contact's own and, for a contact in a worktree,
 *   the same folder in the main checkout
 * @param {string} [platform]
 * @returns {string | null}  null for a file in none of them
 */
export function scriptFileCommand(file, folders, platform = process.platform) {
  const real = realPath(file);
  for (const folder of folders) {
    const relative = path.relative(realPath(folder), real);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
    const posix = relative.split(path.sep).join('/');
    // Without a slash in it, the shell would look for the script on the PATH.
    const word = shellWord(posix.includes('/') ? posix : `./${posix}`);
    return startsByItself(real, platform) ? word : `${interpreterOf(real)} ${word}`;
  }
  return null;
}

// ---- a guess at what starts a project -----------------------------------------------------------

// The scripts that keep running, the likeliest first.
const SCRIPTS = ['dev', 'start', 'serve', 'watch'];
const LOCKFILES = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
  'package-lock.json': 'npm',
};
// These take their port as an option and don't look at PORT. Only a script that is nothing
// but the server can be handed one: after `concurrently "vite" …` it would go to the wrong program.
const WANTS_PORT_OPTION = /^\s*(vite(?!\s+(?:build|optimize)\b)|astro dev|ng serve)\b/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null; // not there, or not JSON
  }
}

/** `cwd` and the folders around it, up to the top of its repository. Outside one, `cwd` alone. */
function upToRepository(cwd) {
  const dirs = [];
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    dirs.push(dir);
    if (fs.existsSync(path.join(dir, '.git'))) return dirs;
    if (dir === path.dirname(dir)) return [cwd];
  }
}

/** npm, pnpm, yarn or bun: the one the project names, or else the one whose lockfile is there. */
function packageManager(cwd, pkg) {
  const named = String(pkg.packageManager || '').split('@')[0];
  if (Object.values(LOCKFILES).includes(named)) return named;
  // A package in a workspace has its lockfile at the top of the repository.
  for (const dir of upToRepository(cwd)) {
    const lockfile = Object.keys(LOCKFILES).find((name) => fs.existsSync(path.join(dir, name)));
    if (lockfile) return LOCKFILES[lockfile];
  }
  return 'npm';
}

/**
 * How each package manager is told to run a script, and to pass an option on to it. pnpm and yarn
 * run one of SCRIPTS by its name alone; any other could be named as one of their own commands is,
 * such as `update`, so it is run with `run`.
 */
function scriptCommand(manager, script, option) {
  const name = shellWord(script);
  if (manager === 'npm') {
    const run = script === 'start' ? 'npm start' : `npm run ${name}`;
    return option ? `${run} -- ${option}` : run;
  }
  const run = manager === 'bun' || !SCRIPTS.includes(script) ? `${manager} run ${name}` : `${manager} ${name}`;
  return option ? `${run} ${option}` : run;
}

/** What gets a checkout of a project ready, by the package manager it uses. */
const INSTALLS = { pnpm: 'pnpm install', yarn: 'yarn install', bun: 'bun install', npm: 'npm install' };

/**
 * What installs a project's packages in other languages, by the file that says it has them. For each
 * language, the first of its files that is there: uv's lockfile says more than a requirements.txt.
 */
const OTHER_INSTALLS = [
  [['Gemfile', 'bundle install']],
  [
    ['uv.lock', 'uv sync'],
    ['requirements.txt', 'pip install -r requirements.txt'],
  ],
  [['go.mod', 'go mod download']],
  [['Cargo.toml', 'cargo fetch']],
];

// Run by npm itself around installing and publishing, each also with pre or post before it, as is a
// script's own `pretest`: not something to start from the Run button.
const HOOKS = ['install', 'uninstall', 'prepare', 'publish', 'prepublishOnly', 'pack', 'version', 'dependencies'];

// What starts a project's containers, which its cleanup script stops.
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

/** A folder's package.json, or null for one that isn't there or isn't one. */
function packageJson(cwd) {
  const pkg = readJson(path.join(cwd, 'package.json'));
  return pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? pkg : null;
}

/** The scripts a package.json has, by name: only the ones with a command. */
const scriptsOf = (pkg) =>
  Object.entries(
    pkg?.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts) ? pkg.scripts : {}
  ).filter(([, command]) => typeof command === 'string' && command.trim());

/** Whether a package.json script is one npm runs around another, or around installing and publishing. */
function isHook(name, names) {
  if (HOOKS.includes(name)) return true;
  const around = /^(pre|post)(.+)$/.exec(name)?.[2];
  return Boolean(around) && (HOOKS.includes(around) || names.includes(around));
}

/**
 * A guess at the script that sets up a new worktree of the project in a folder: installing
 * what its package.json asks for, with the package manager it uses, and what a Gemfile, a
 * Python project, a go.mod or a Cargo.toml asks for, a line each. Or else its own bin/setup.
 * @param {string} cwd
 * @returns {string}  '' when nothing in the folder says
 */
export function suggestSetupCommand(cwd) {
  const pkg = packageJson(cwd);
  // Keep the project's own setup convention ahead of the language fallbacks.
  if (!pkg && fs.existsSync(path.join(cwd, 'bin', 'setup'))) return 'bin/setup';
  const others = OTHER_INSTALLS.map((files) => files.find(([file]) => fs.existsSync(path.join(cwd, file)))?.[1] ?? '');
  const installs = [pkg ? INSTALLS[packageManager(cwd, pkg)] : '', ...others].filter(Boolean);
  return installs.join('\n');
}

/**
 * Guesses at the commands Run could start in a folder, the likeliest first: the dev script of
 * its package.json, run with the package manager it uses and handed the contact's port where it
 * needs to be, then its own bin/dev, then the other scripts of its package.json in their order.
 * @param {string} cwd
 * @returns {{ name: string, command: string, keepsRunning: boolean }[]}  none when nothing in the folder
 *   says. `keepsRunning`: one that starts the project, such as a dev server, not a build or a lint
 */
export function suggestRunCommands(cwd) {
  const pkg = packageJson(cwd);
  const scripts = scriptsOf(pkg);
  const names = scripts.map(([name]) => name);
  const manager = scripts.length ? packageManager(cwd, pkg) : 'npm';
  const main = SCRIPTS.find((name) => names.includes(name));
  const found = [];
  const commandFor = (name) => {
    const body = pkg.scripts[name];
    const wantsPort = WANTS_PORT_OPTION.test(body) && !/--port\b/.test(body);
    // The shell that runs the command fills in the contact's port.
    return scriptCommand(manager, name, wantsPort ? '--port $PORT' : '');
  };
  if (main) found.push({ name: main, command: commandFor(main), keepsRunning: true });
  if (fs.existsSync(path.join(cwd, 'bin', 'dev')))
    found.push({ name: 'bin/dev', command: 'bin/dev', keepsRunning: true });
  for (const name of names) {
    if (name === main || isHook(name, names)) continue;
    found.push({ name, command: commandFor(name), keepsRunning: SCRIPTS.includes(name) });
  }
  return found;
}

/**
 * A guess at the command that starts the project in a folder, for the dialog that asks
 * for it: the likeliest of suggestRunCommands.
 * @param {string} cwd
 * @returns {string}  '' when nothing in the folder says
 */
export function suggestRunCommand(cwd) {
  const [likeliest] = suggestRunCommands(cwd);
  // A build or a lint is no guess at what starts the project.
  return likeliest?.keepsRunning ? likeliest.command : '';
}

/**
 * A guess at the script run in a worktree before it is removed: stopping the containers its
 * compose file starts. Nothing else is safe to guess.
 * @param {string} cwd
 * @returns {string}  '' when there is no compose file
 */
export function suggestCleanupCommand(cwd) {
  return COMPOSE_FILES.some((file) => fs.existsSync(path.join(cwd, file))) ? 'docker compose down' : '';
}

/**
 * Guesses at every script of a project, from what its main checkout has, for Settings to fill in.
 * Only looks at files: nothing is run.
 * @param {string} root
 * @returns {{ setup: string, run: ReturnType<typeof suggestRunCommands>, cleanup: string }}
 */
export function suggestScripts(root) {
  return { setup: suggestSetupCommand(root), run: suggestRunCommands(root), cleanup: suggestCleanupCommand(root) };
}
